package net.xywren.bluemapmarkertool;

import de.bluecolored.bluemap.api.BlueMapAPI;
import de.bluecolored.bluemap.api.BlueMapMap;
import de.bluecolored.bluemap.api.markers.*;
import de.bluecolored.bluemap.api.math.Color;
import de.bluecolored.bluemap.api.math.Shape;
import com.flowpowered.math.vector.Vector2d;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Persists markers to disk and syncs area markers to BlueMapAPI.
 * Text/label markers are rendered client-side by area-draw.js.
 */
public class MarkerStore {

    private final Path dataFile;
    private String cachedJson = "{\"items\":[]}";

    public MarkerStore(Path serverRoot) {
        Path configDir = serverRoot.resolve("config").resolve("xynovia");
        try { Files.createDirectories(configDir); } catch (IOException ignored) {}
        this.dataFile = configDir.resolve("markers.json");

        loadFromDisk();

        // Hook into BlueMapAPI whenever it becomes available
        BlueMapAPI.onEnable(api -> {
            BlueMapMarkerTool.LOGGER.info("[BlueMapMarkerTool] BlueMap enabled — deploying web assets and pushing markers.");
            deployWebAssets(api);
            pushToBlueMap(api);
        });
    }

    public synchronized String getJson() {
        return cachedJson;
    }

    public synchronized void saveJson(String json) {
        cachedJson = json;
        try {
            Files.writeString(dataFile, json, StandardCharsets.UTF_8);
        } catch (IOException e) {
            BlueMapMarkerTool.LOGGER.error("[BlueMapMarkerTool] Failed to save markers.json", e);
        }
        BlueMapAPI.getInstance().ifPresent(this::pushToBlueMap);
    }

    private void deployWebAssets(de.bluecolored.bluemap.api.BlueMapAPI api) {
        try {
            Path webRoot = api.getWebApp().getWebRoot();
            Files.createDirectories(webRoot);

            // Copy bundled area-draw.js into BlueMap's webroot
            Path target = webRoot.resolve("area-draw.js");
            try (InputStream in = getClass().getResourceAsStream("/assets/bluemap_marker_tool/area-draw.js")) {
                if (in == null) { BlueMapMarkerTool.LOGGER.error("[BlueMapMarkerTool] Bundled area-draw.js not found in jar!"); return; }
                Files.copy(in, target, StandardCopyOption.REPLACE_EXISTING);
            }

            // Write xyn-config.json so the JS knows the API port
            int port = MarkerConfig.API_PORT.get();
            Files.writeString(webRoot.resolve("xyn-config.json"),
                "{\"apiPort\":" + port + "}", StandardCharsets.UTF_8);

            // Register the script with BlueMap's webapp (adds it to settings.json automatically)
            api.getWebApp().registerScript("area-draw.js");

            BlueMapMarkerTool.LOGGER.info("[BlueMapMarkerTool] Web assets deployed to {} (apiPort={})", webRoot, port);
        } catch (IOException e) {
            BlueMapMarkerTool.LOGGER.error("[BlueMapMarkerTool] Failed to deploy web assets", e);
        }
    }

    private void loadFromDisk() {
        if (Files.exists(dataFile)) {
            try {
                cachedJson = Files.readString(dataFile, StandardCharsets.UTF_8);
                BlueMapMarkerTool.LOGGER.info("[BlueMapMarkerTool] Loaded markers from disk.");
            } catch (IOException e) {
                BlueMapMarkerTool.LOGGER.error("[BlueMapMarkerTool] Failed to load markers.json", e);
            }
        }
    }


    private void pushToBlueMap(BlueMapAPI api) {
        Optional<BlueMapMap> mapOpt = api.getMap(MarkerConfig.MAP_ID.get());
        if (mapOpt.isEmpty()) {
            BlueMapMarkerTool.LOGGER.warn("[BlueMapMarkerTool] Map '{}' not found in BlueMap.", MarkerConfig.MAP_ID.get());
            return;
        }
        BlueMapMap map = mapOpt.get();

        // Clear and rebuild the marker set
        map.getMarkerSets().remove("xyn-areas");
        MarkerSet set = new MarkerSet("Areas");
        set.setToggleable(true);

        parseAndAddMarkers(set);

        if (!set.getMarkers().isEmpty()) {
            map.getMarkerSets().put("xyn-areas", set);
        }
    }

    private void parseAndAddMarkers(MarkerSet set) {
        // Minimal JSON parsing — extract area items without pulling in a JSON library
        try {
            List<Map<String, Object>> items = parseItems(cachedJson);
            for (Map<String, Object> item : items) {
                String type = (String) item.get("type");
                if (!"area".equals(type)) continue;

                String id = (String) item.getOrDefault("id", "marker");
                String title = (String) item.getOrDefault("title", "");
                String subtitle = (String) item.getOrDefault("subtitle", "");
                String colorHex = (String) item.getOrDefault("color", "#4caf50");
                double fill = toDouble(item.getOrDefault("fill", 0.25));
                double y = toDouble(item.getOrDefault("y", 64.0));

                @SuppressWarnings("unchecked")
                List<Map<String, Object>> rawPts = (List<Map<String, Object>>) item.get("points");
                if (rawPts == null || rawPts.size() < 3) continue;

                int[] rgb = hexToRgb(colorHex);
                Color lineColor = new Color(rgb[0], rgb[1], rgb[2], 255);
                Color fillColor = new Color(rgb[0], rgb[1], rgb[2], (int) (fill * 255));

                Shape.Builder shapeBuilder = Shape.builder();
                for (Map<String, Object> pt : rawPts) {
                    shapeBuilder.addPoint(new Vector2d(toDouble(pt.get("x")), toDouble(pt.get("z"))));
                }
                Shape shape = shapeBuilder.build();

                String detail = subtitle.isEmpty() ? title : title + "<br><i>" + subtitle + "</i>";
                ShapeMarker marker = ShapeMarker.builder()
                    .label(title)
                    .detail(detail)
                    .shape(shape, (float) y)
                    .lineColor(lineColor)
                    .fillColor(fillColor)
                    .lineWidth(3)
                    .depthTestEnabled(false)
                    .build();

                set.getMarkers().put(id, marker);
            }
        } catch (Exception e) {
            BlueMapMarkerTool.LOGGER.error("[BlueMapMarkerTool] Failed to parse markers for BlueMap push", e);
        }
    }

    // ---- very small hand-rolled JSON helpers (avoids adding a JSON lib dependency) ----

    private List<Map<String, Object>> parseItems(String json) {
        // Find "items":[...]
        int start = json.indexOf("\"items\"");
        if (start < 0) return Collections.emptyList();
        int arrStart = json.indexOf('[', start);
        if (arrStart < 0) return Collections.emptyList();
        int arrEnd = matchingBracket(json, arrStart, '[', ']');
        if (arrEnd < 0) return Collections.emptyList();
        String arrStr = json.substring(arrStart + 1, arrEnd).trim();
        return parseObjectArray(arrStr);
    }

    private List<Map<String, Object>> parseObjectArray(String s) {
        List<Map<String, Object>> result = new ArrayList<>();
        int i = 0;
        while (i < s.length()) {
            int objStart = s.indexOf('{', i);
            if (objStart < 0) break;
            int objEnd = matchingBracket(s, objStart, '{', '}');
            if (objEnd < 0) break;
            result.add(parseObject(s.substring(objStart + 1, objEnd)));
            i = objEnd + 1;
        }
        return result;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> parseObject(String s) {
        Map<String, Object> map = new LinkedHashMap<>();
        int i = 0;
        while (i < s.length()) {
            // Find key
            int kq = s.indexOf('"', i); if (kq < 0) break;
            int kq2 = s.indexOf('"', kq + 1); if (kq2 < 0) break;
            String key = s.substring(kq + 1, kq2);
            int colon = s.indexOf(':', kq2 + 1); if (colon < 0) break;
            i = colon + 1;
            while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++;
            if (i >= s.length()) break;
            char c = s.charAt(i);
            if (c == '"') {
                int vq2 = s.indexOf('"', i + 1); if (vq2 < 0) break;
                map.put(key, s.substring(i + 1, vq2));
                i = vq2 + 1;
            } else if (c == '{') {
                int end = matchingBracket(s, i, '{', '}'); if (end < 0) break;
                map.put(key, parseObject(s.substring(i + 1, end)));
                i = end + 1;
            } else if (c == '[') {
                int end = matchingBracket(s, i, '[', ']'); if (end < 0) break;
                String inner = s.substring(i + 1, end).trim();
                if (inner.startsWith("{")) map.put(key, parseObjectArray(inner));
                else map.put(key, inner);
                i = end + 1;
            } else {
                // number or boolean
                int end = i;
                while (end < s.length() && s.charAt(end) != ',' && s.charAt(end) != '}') end++;
                String val = s.substring(i, end).trim();
                if ("true".equals(val)) map.put(key, Boolean.TRUE);
                else if ("false".equals(val)) map.put(key, Boolean.FALSE);
                else if ("null".equals(val)) map.put(key, null);
                else { try { map.put(key, Double.parseDouble(val)); } catch (NumberFormatException ignored) { map.put(key, val); } }
                i = end;
            }
        }
        return map;
    }

    private int matchingBracket(String s, int open, char openCh, char closeCh) {
        int depth = 0;
        boolean inStr = false;
        for (int i = open; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '"' && (i == 0 || s.charAt(i - 1) != '\\')) inStr = !inStr;
            if (inStr) continue;
            if (c == openCh) depth++;
            else if (c == closeCh) { depth--; if (depth == 0) return i; }
        }
        return -1;
    }

    private double toDouble(Object v) {
        if (v instanceof Number n) return n.doubleValue();
        if (v instanceof String str) { try { return Double.parseDouble(str); } catch (NumberFormatException ignored) {} }
        return 0.0;
    }

    private int[] hexToRgb(String hex) {
        hex = hex.replace("#", "");
        if (hex.length() == 3) hex = "" + hex.charAt(0) + hex.charAt(0) + hex.charAt(1) + hex.charAt(1) + hex.charAt(2) + hex.charAt(2);
        int r = Integer.parseInt(hex.substring(0, 2), 16);
        int g = Integer.parseInt(hex.substring(2, 4), 16);
        int b = Integer.parseInt(hex.substring(4, 6), 16);
        return new int[]{r, g, b};
    }
}
