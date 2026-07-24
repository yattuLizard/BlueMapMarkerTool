package net.xywren.bluemapmarkertool;

import net.neoforged.neoforge.common.ModConfigSpec;

public class MarkerConfig {

    public static final ModConfigSpec.Builder BUILDER = new ModConfigSpec.Builder();
    public static final ModConfigSpec SPEC;

    public static final ModConfigSpec.IntValue API_PORT;
    public static final ModConfigSpec.ConfigValue<String> SECRET;
    public static final ModConfigSpec.ConfigValue<String> MAP_ID;

    static {
        BUILDER.comment("Xynovia Markers configuration");

        API_PORT = BUILDER
            .comment("Port for the marker REST API. Must be an allocated port on your host.",
                     "Set this to whatever port PebbleHost assigned you for the marker API.")
            .defineInRange("api_port", 8048, 1024, 65535);

        SECRET = BUILDER
            .comment("Secret password required to save markers via the web editor.",
                     "Change this to something only you know.")
            .define("secret", "changeme");

        MAP_ID = BUILDER
            .comment("BlueMap map ID to sync markers to (usually 'overworld').")
            .define("map_id", "overworld");

        SPEC = BUILDER.build();
    }
}
