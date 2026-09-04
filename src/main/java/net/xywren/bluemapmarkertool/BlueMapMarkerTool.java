package net.xywren.bluemapmarkertool;

import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.ModContainer;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.config.ModConfig;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.server.ServerStartingEvent;
import net.neoforged.neoforge.event.server.ServerStoppingEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@Mod(BlueMapMarkerTool.MOD_ID)
public class BlueMapMarkerTool {

    public static final String MOD_ID = "bluemap_marker_tool";
    public static final String VERSION = "1.3.1";
    public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

    private MarkerHttpServer httpServer;
    private MarkerStore store;

    public BlueMapMarkerTool(IEventBus modEventBus, ModContainer container) {
        container.registerConfig(ModConfig.Type.SERVER, MarkerConfig.SPEC, "bluemap-marker-tool.toml");
        AdminWebAssets.register();
        NeoForge.EVENT_BUS.addListener(this::onServerStarting);
        NeoForge.EVENT_BUS.addListener(this::onServerStopping);
    }

    private void onServerStarting(ServerStartingEvent event) {
        store = new MarkerStore(event.getServer().getServerDirectory());
        httpServer = new MarkerHttpServer(store);
        httpServer.start();
    }

    private void onServerStopping(ServerStoppingEvent event) {
        if (httpServer != null) httpServer.stop();
    }
}
