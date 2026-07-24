package net.xywren.bluemapmarkertool;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.*;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;

/**
 * Tiny HTTP server exposing two endpoints:
 *   GET  /xyn/markers  — returns the current markers JSON (public)
 *   POST /xyn/markers  — saves new markers JSON (requires Authorization: Bearer <secret>)
 */
public class MarkerHttpServer {

    private final MarkerStore store;
    private HttpServer server;

    public MarkerHttpServer(MarkerStore store) {
        this.store = store;
    }

    public void start() {
        int port = MarkerConfig.API_PORT.get();
        try {
            server = HttpServer.create(new InetSocketAddress(port), 0);
            server.createContext("/xyn/markers", this::handle);
            server.setExecutor(Executors.newSingleThreadExecutor(r -> {
                Thread t = new Thread(r, "xyn-markers-http");
                t.setDaemon(true);
                return t;
            }));
            server.start();
            BlueMapMarkerTool.LOGGER.info("[BlueMapMarkerTool] Marker API started on port {}", port);
        } catch (IOException e) {
            BlueMapMarkerTool.LOGGER.error("[BlueMapMarkerTool] Failed to start HTTP server on port {}: {}", port, e.getMessage());
        }
    }

    public void stop() {
        if (server != null) {
            server.stop(1);
            BlueMapMarkerTool.LOGGER.info("[BlueMapMarkerTool] Marker API stopped.");
        }
    }

    private void handle(HttpExchange ex) throws IOException {
        // CORS — allow the BlueMap webapp to call us from any origin
        ex.getResponseHeaders().add("Access-Control-Allow-Origin", "*");
        ex.getResponseHeaders().add("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        ex.getResponseHeaders().add("Access-Control-Allow-Headers", "Authorization, Content-Type");

        String method = ex.getRequestMethod();

        if ("OPTIONS".equalsIgnoreCase(method)) {
            send(ex, 204, "");
            return;
        }

        if ("GET".equalsIgnoreCase(method)) {
            String json = store.getJson();
            ex.getResponseHeaders().add("Content-Type", "application/json; charset=utf-8");
            send(ex, 200, json);
            return;
        }

        if ("POST".equalsIgnoreCase(method)) {
            String body = new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            if (body.isBlank()) { send(ex, 400, "{\"error\":\"empty body\"}"); return; }
            store.saveJson(body);
            BlueMapMarkerTool.LOGGER.info("[BlueMapMarkerTool] Markers saved via web editor.");
            send(ex, 200, "{\"ok\":true}");
            return;
        }

        send(ex, 405, "{\"error\":\"method not allowed\"}");
    }

    private void send(HttpExchange ex, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        ex.sendResponseHeaders(status, bytes.length);
        try (OutputStream os = ex.getResponseBody()) { os.write(bytes); }
    }
}
