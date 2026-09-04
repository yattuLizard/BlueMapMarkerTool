package net.xywren.bluemapmarkertool;

import de.bluecolored.bluemap.api.BlueMapAPI;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;

public final class AdminWebAssets {

    private AdminWebAssets() {}

    public static void register() {
        BlueMapAPI.onEnable(api -> {
            try {
                Path webRoot = api.getWebApp().getWebRoot();
                Files.createDirectories(webRoot);

                deploy(webRoot, "admin-menu.js");
                deploy(webRoot, "text-markers.js");

                api.getWebApp().registerScript("admin-menu.js?v=" + BlueMapMarkerTool.VERSION);
                api.getWebApp().registerScript("text-markers.js?v=" + BlueMapMarkerTool.VERSION);
                BlueMapMarkerTool.LOGGER.info("[BlueMapMarkerTool] Administrator and text marker web assets deployed.");
            } catch (IOException e) {
                BlueMapMarkerTool.LOGGER.error("[BlueMapMarkerTool] Failed to deploy web assets", e);
            }
        });
    }

    private static void deploy(Path webRoot, String fileName) throws IOException {
        Path target = webRoot.resolve(fileName);
        try (InputStream in = AdminWebAssets.class.getResourceAsStream("/assets/bluemap_marker_tool/" + fileName)) {
            if (in == null) {
                throw new IOException("Bundled web asset not found: " + fileName);
            }
            Files.copy(in, target, StandardCopyOption.REPLACE_EXISTING);
        }
    }
}
