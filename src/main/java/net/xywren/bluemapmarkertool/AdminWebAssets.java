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

                Path target = webRoot.resolve("admin-menu.js");
                try (InputStream in = AdminWebAssets.class.getResourceAsStream("/assets/bluemap_marker_tool/admin-menu.js")) {
                    if (in == null) {
                        BlueMapMarkerTool.LOGGER.error("[BlueMapMarkerTool] Bundled admin-menu.js not found in jar!");
                        return;
                    }
                    Files.copy(in, target, StandardCopyOption.REPLACE_EXISTING);
                }

                api.getWebApp().registerScript("admin-menu.js?v=" + BlueMapMarkerTool.VERSION);
                BlueMapMarkerTool.LOGGER.info("[BlueMapMarkerTool] Administrator menu web asset deployed.");
            } catch (IOException e) {
                BlueMapMarkerTool.LOGGER.error("[BlueMapMarkerTool] Failed to deploy administrator menu web asset", e);
            }
        });
    }
}
