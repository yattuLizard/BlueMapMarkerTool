package net.xywren.bluemapmarkertool;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.*;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
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
            if ("changeme".equals(MarkerConfig.SECRET.get())) {
                BlueMapMarkerTool.LOGGER.warn("[BlueMapMarkerTool] The marker editor password is still set to the default value. Change 'secret' in bluemap-marker-tool.toml before exposing the editor publicly.");
            }
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
            if (!isAuthorized(ex)) {
                ex.getResponseHeaders().add("Content-Type", "application/json; charset=utf-8");
                send(ex, 403, "{\"error\":\"forbidden\"}");
                return;
            }

            String body = new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            if (body.isBlank()) {
                send(ex, 400, "{\"error\":\"empty body\"}");
                return;
            }

            store.saveJson(body);
            BlueMapMarkerTool.LOGGER.info("[BlueMapMarkerTool] Markers saved via web editor.");
            ex.getResponseHeaders().add("Content-Type", "application/json; charset=utf-8");
            send(ex, 200, "{\"ok\":true}");
            return;
        }

        send(ex, 405, "{\"error\":\"method not allowed\"}");
    }

    private boolean isAuthorized(HttpExchange ex) {
        String authorization = ex.getRequestHeaders().getFirst("Authorization");
        if (authorization == null || !authorization.startsWith("Bearer ")) return false;

        String supplied = authorization.substring("Bearer ".length());
        String configured = MarkerConfig.SECRET.get();
        if (configured == null || configured.isEmpty()) return false;

        return MessageDigest.isEqual(
            supplied.getBytes(StandardCharsets.UTF_8),
            configured.getBytes(StandardCharsets.UTF_8)
        );
    }

    private void send(HttpExchange ex, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        ex.sendResponseHeaders(status, bytes.length);
        try (OutputStream os = ex.getResponseBody()) {
            os.write(bytes);
        }
    }
}
