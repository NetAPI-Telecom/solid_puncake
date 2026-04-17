// =============================================================================
// NetAPI Quickstart — Java Backend (using com.sun.net.httpserver, no Spring)
//
// Zero dependencies. Runs on any JDK 17+.
// Run with: java src/App.java
// =============================================================================

import com.sun.net.httpserver.*;
import java.io.*;
import java.net.*;
import java.net.http.*;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.*;
import java.util.*;
import java.util.stream.*;

public class App {
    static String NETAPI_BASE_URL;
    static String NETAPI_CLIENT_ID;
    static String NETAPI_CLIENT_SECRET;
    static HttpClient httpClient = HttpClient.newHttpClient();

    public static void main(String[] args) throws Exception {
        loadEnv();

        NETAPI_BASE_URL = getEnv("NETAPI_BASE_URL", "https://api.netapi.africa");
        NETAPI_CLIENT_ID = getEnv("NETAPI_CLIENT_ID", "");
        NETAPI_CLIENT_SECRET = getEnv("NETAPI_CLIENT_SECRET", "");

        if (NETAPI_CLIENT_ID.isEmpty() || NETAPI_CLIENT_SECRET.isEmpty()) {
            System.err.println("\n  Missing credentials!");
            System.err.println("  Edit .env with your NETAPI_CLIENT_ID and NETAPI_CLIENT_SECRET");
            System.err.println("  Get them from: https://api.netapi.africa -> Dashboard -> Getting Started\n");
            System.exit(1);
        }

        var server = HttpServer.create(new InetSocketAddress(3000), 0);

        // API endpoint
        server.createContext("/api/check-sim-swap", App::handleCheckSimSwap);

        // Serve frontend files
        server.createContext("/", exchange -> {
            String path = exchange.getRequestURI().getPath();
            if (path.equals("/")) path = "/index.html";
            // In Docker: mounted at /app/frontend. Natively: ../../frontend.
            String frontendBase = Files.exists(Path.of("/app/frontend")) ? "/app/frontend" : "../../frontend";
            Path filePath = Path.of(frontendBase + path);
            if (Files.exists(filePath)) {
                byte[] content = Files.readAllBytes(filePath);
                String ct = path.endsWith(".html") ? "text/html" : path.endsWith(".js") ? "application/javascript" : "text/plain";
                exchange.getResponseHeaders().set("Content-Type", ct);
                exchange.sendResponseHeaders(200, content.length);
                exchange.getResponseBody().write(content);
            } else {
                exchange.sendResponseHeaders(404, 0);
            }
            exchange.close();
        });

        server.start();
        System.out.println("\n  ============================================");
        System.out.println("  LendSafe — NetAPI SIM Swap Quickstart");
        System.out.println("  ============================================\n");
        System.out.println("  App running at:    http://localhost:3000");
        System.out.println("  NetAPI endpoint:   " + NETAPI_BASE_URL);
        System.out.println("  Client ID:         " + NETAPI_CLIENT_ID.substring(0, 12) + "...\n");
    }

    static void handleCheckSimSwap(HttpExchange exchange) throws IOException {
        if (!"POST".equals(exchange.getRequestMethod())) {
            exchange.sendResponseHeaders(405, 0); exchange.close(); return;
        }

        String body = new String(exchange.getRequestBody().readAllBytes());
        String phoneNumber = extractJsonString(body, "phoneNumber");
        var trace = new ArrayList<String>();

        // Helper to build trace JSON entries
        var traceEntries = new ArrayList<Map<String, Object>>();
        Runnable[] addTrace = { null };

        try {
            // =================================================================
            // STEP 1: Get an Access Token (Client Credentials)
            // =================================================================
            traceEntries.add(Map.of("type", "request", "message", "POST " + NETAPI_BASE_URL + "/oauth/token"));

            String tokenBody = "grant_type=client_credentials"
                + "&client_id=" + URLEncoder.encode(NETAPI_CLIENT_ID, "UTF-8")
                + "&client_secret=" + URLEncoder.encode(NETAPI_CLIENT_SECRET, "UTF-8")
                + "&scope=" + URLEncoder.encode("sim-swap:check", "UTF-8");

            var tokenReq = HttpRequest.newBuilder()
                .uri(URI.create(NETAPI_BASE_URL + "/oauth/token"))
                .header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString(tokenBody))
                .build();

            var tokenResp = httpClient.send(tokenReq, HttpResponse.BodyHandlers.ofString());
            String accessToken = extractJsonString(tokenResp.body(), "access_token");

            if (tokenResp.statusCode() != 200 || accessToken == null) {
                traceEntries.add(Map.of("type", "error", "message", "Token failed: " + tokenResp.statusCode()));
                sendJson(exchange, "{\"success\":false,\"error\":\"Authentication failed\",\"trace\":" + toJsonArray(traceEntries) + "}");
                return;
            }

            traceEntries.add(Map.of("type", "response", "message", "200 OK — Token received (" + accessToken.substring(0, 20) + "...)"));

            // =================================================================
            // STEP 2: Call the SIM Swap API
            // =================================================================
            traceEntries.add(Map.of("type", "request", "message", "POST " + NETAPI_BASE_URL + "/sim-swap/v2/check"));

            var swapReq = HttpRequest.newBuilder()
                .uri(URI.create(NETAPI_BASE_URL + "/sim-swap/v2/check"))
                .header("Authorization", "Bearer " + accessToken)
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("{\"phoneNumber\":\"" + phoneNumber + "\"}"))
                .build();

            var swapResp = httpClient.send(swapReq, HttpResponse.BodyHandlers.ofString());
            String swapJson = swapResp.body();
            boolean swapped = swapJson.contains("\"swapped\":true");

            if (swapResp.statusCode() != 200) {
                traceEntries.add(Map.of("type", "error", "message", "SIM Swap failed: " + swapResp.statusCode()));
                sendJson(exchange, "{\"success\":false,\"error\":\"SIM Swap check failed\",\"trace\":" + toJsonArray(traceEntries) + "}");
                return;
            }

            traceEntries.add(Map.of("type", "response", "message", "200 OK — swapped: " + swapped));

            sendJson(exchange, "{\"success\":true,\"swapped\":" + swapped + ",\"trace\":" + toJsonArray(traceEntries) + "}");

        } catch (Exception e) {
            traceEntries.add(Map.of("type", "error", "message", "Error: " + e.getMessage()));
            sendJson(exchange, "{\"success\":false,\"error\":\"" + e.getMessage() + "\",\"trace\":" + toJsonArray(traceEntries) + "}");
        }
    }

    // --- Helpers ---

    static String extractJsonString(String json, String key) {
        String search = "\"" + key + "\":\"";
        int idx = json.indexOf(search);
        if (idx == -1) return null;
        int start = idx + search.length();
        int end = json.indexOf("\"", start);
        return end > start ? json.substring(start, end) : null;
    }

    static void sendJson(HttpExchange exchange, String json) throws IOException {
        byte[] bytes = json.getBytes();
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(200, bytes.length);
        exchange.getResponseBody().write(bytes);
        exchange.close();
    }

    static String toJsonArray(List<Map<String, Object>> entries) {
        return "[" + entries.stream()
            .map(e -> "{\"type\":\"" + e.get("type") + "\",\"message\":\"" + ((String)e.get("message")).replace("\"", "\\\"") + "\"}")
            .collect(Collectors.joining(",")) + "]";
    }

    static void loadEnv() {
        try {
            Path envFile = Path.of(".env");
            if (Files.exists(envFile)) {
                Files.lines(envFile).forEach(line -> {
                    line = line.trim();
                    if (line.isEmpty() || line.startsWith("#")) return;
                    String[] parts = line.split("=", 2);
                    if (parts.length == 2 && !parts[1].isEmpty()) {
                        System.setProperty(parts[0].trim(), parts[1].trim());
                    }
                });
            }
        } catch (Exception e) { /* ignore */ }
    }

    static String getEnv(String key, String def) {
        String val = System.getenv(key);
        if (val != null && !val.isEmpty()) return val;
        val = System.getProperty(key);
        if (val != null && !val.isEmpty()) return val;
        return def;
    }
}
