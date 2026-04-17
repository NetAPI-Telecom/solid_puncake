<?php
// =============================================================================
// NetAPI Quickstart — PHP Backend
//
// This server does two things:
// 1. Serves the LendSafe demo frontend (the bank UI)
// 2. Handles SIM Swap verification requests by talking to NetAPI
//
// Run with: php -S localhost:3000 index.php
// =============================================================================

// Load .env
$envFile = __DIR__ . '/.env';
if (file_exists($envFile)) {
    foreach (file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        if (strpos(trim($line), '#') === 0) continue;
        if (strpos($line, '=') === false) continue;
        putenv(trim($line));
    }
}

$NETAPI_BASE_URL = getenv('NETAPI_BASE_URL') ?: 'https://api.netapi.africa';
$NETAPI_CLIENT_ID = getenv('NETAPI_CLIENT_ID');
$NETAPI_CLIENT_SECRET = getenv('NETAPI_CLIENT_SECRET');

if (!$NETAPI_CLIENT_ID || !$NETAPI_CLIENT_SECRET) {
    die("Missing credentials. Edit .env with your NETAPI_CLIENT_ID and NETAPI_CLIENT_SECRET.\n");
}

// Route requests
$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

if ($uri === '/api/check-sim-swap' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    header('Content-Type: application/json');
    $input = json_decode(file_get_contents('php://input'), true);
    $phoneNumber = $input['phoneNumber'] ?? '';
    $trace = [];

    $log = function($type, $message, $detail = null) use (&$trace) {
        $entry = ['type' => $type, 'message' => $message];
        if ($detail) $entry['detail'] = $detail;
        $trace[] = $entry;
    };

    // Helper for HTTP requests
    $httpPost = function($url, $data, $headers = []) {
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_POST, true);

        if (is_string($data)) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $data);
        } else {
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
        }

        $allHeaders = [];
        foreach ($headers as $k => $v) $allHeaders[] = "$k: $v";
        curl_setopt($ch, CURLOPT_HTTPHEADER, $allHeaders);

        $body = curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);

        return ['status' => $status, 'body' => json_decode($body, true), 'error' => $error];
    };

    try {
        // =================================================================
        // STEP 1: CIBA Authentication
        // =================================================================
        $log('request', "POST $NETAPI_BASE_URL/oauth/bc-authorize", [
            'title' => 'CIBA Authentication Request',
            'body' => [
                'login_hint' => "tel:$phoneNumber",
                'scope' => 'openid dpv:FraudPreventionAndDetection sim-swap:check',
                'client_id' => $NETAPI_CLIENT_ID,
                'client_secret' => '***hidden***'
            ]
        ]);

        $cibaResp = $httpPost("$NETAPI_BASE_URL/oauth/bc-authorize",
            http_build_query([
                'login_hint' => "tel:$phoneNumber",
                'scope' => 'openid dpv:FraudPreventionAndDetection sim-swap:check',
                'client_id' => $NETAPI_CLIENT_ID,
                'client_secret' => $NETAPI_CLIENT_SECRET
            ]),
            ['Content-Type' => 'application/x-www-form-urlencoded']
        );

        if ($cibaResp['status'] !== 200 || !isset($cibaResp['body']['auth_req_id'])) {
            $log('error', "CIBA failed: {$cibaResp['status']}", [
                'title' => 'CIBA Error Response',
                'body' => $cibaResp['body']
            ]);
            echo json_encode(['success' => false, 'error' => $cibaResp['body']['error_description'] ?? 'Auth failed', 'trace' => $trace]);
            exit;
        }

        $authReqId = $cibaResp['body']['auth_req_id'];
        $log('response', "200 OK — auth_req_id: " . substr($authReqId, 0, 16) . "...", [
            'title' => 'CIBA Response',
            'body' => ['auth_req_id' => $authReqId, 'expires_in' => $cibaResp['body']['expires_in'] ?? null]
        ]);

        // =================================================================
        // STEP 2: Poll for Token
        // =================================================================
        $pollInterval = $cibaResp['body']['interval'] ?? 5;
        $accessToken = null;

        for ($attempt = 1; $attempt <= 6; $attempt++) {
            $log('info', "Polling for token (attempt $attempt/6)...");
            sleep($attempt === 1 ? 2 : $pollInterval);

            $log('request', "POST $NETAPI_BASE_URL/oauth/token");

            $tokenResp = $httpPost("$NETAPI_BASE_URL/oauth/token",
                http_build_query([
                    'grant_type' => 'urn:openid:params:grant-type:ciba',
                    'auth_req_id' => $authReqId,
                    'client_id' => $NETAPI_CLIENT_ID,
                    'client_secret' => $NETAPI_CLIENT_SECRET
                ]),
                ['Content-Type' => 'application/x-www-form-urlencoded']
            );

            if (isset($tokenResp['body']['access_token'])) {
                $accessToken = $tokenResp['body']['access_token'];
                $log('response', "200 OK — Token received (" . substr($accessToken, 0, 20) . "...)");
                break;
            } elseif (($tokenResp['body']['error'] ?? '') === 'authorization_pending') {
                $log('info', 'Authorization pending — operator is processing...');
            } else {
                $log('error', "Token failed: " . ($tokenResp['body']['error'] ?? 'Unknown'));
                echo json_encode(['success' => false, 'error' => 'Token request failed', 'trace' => $trace]);
                exit;
            }
        }

        if (!$accessToken) {
            $log('error', 'Timed out waiting for token');
            echo json_encode(['success' => false, 'error' => 'Authentication timed out', 'trace' => $trace]);
            exit;
        }

        // =================================================================
        // STEP 3: Call the SIM Swap API
        // =================================================================
        $log('request', "POST $NETAPI_BASE_URL/sim-swap/v2/check", [
            'title' => 'SIM Swap Check Request',
            'body' => ['phoneNumber' => $phoneNumber]
        ]);

        $swapResp = $httpPost("$NETAPI_BASE_URL/sim-swap/v2/check",
            ['phoneNumber' => $phoneNumber],
            ['Authorization' => "Bearer $accessToken", 'Content-Type' => 'application/json']
        );

        if ($swapResp['status'] !== 200) {
            $log('error', "SIM Swap failed: {$swapResp['status']}", ['title' => 'Error', 'body' => $swapResp['body']]);
            echo json_encode(['success' => false, 'error' => 'SIM Swap check failed', 'trace' => $trace]);
            exit;
        }

        $log('response', "200 OK — swapped: " . ($swapResp['body']['swapped'] ? 'true' : 'false'), [
            'title' => 'SIM Swap Response',
            'body' => $swapResp['body']
        ]);

        $latest = $swapResp['body']['latestSimChange'] ?? null;
        echo json_encode([
            'success' => true,
            'swapped' => $swapResp['body']['swapped'],
            'swapAge' => $latest ? 'on ' . substr($latest, 0, 10) : null,
            'trace' => $trace
        ]);

    } catch (Exception $e) {
        $log('error', "Error: " . $e->getMessage());
        echo json_encode(['success' => false, 'error' => $e->getMessage(), 'trace' => $trace]);
    }
    exit;
}

// Serve the frontend
// In Docker: mounted at /app/frontend. Natively: ../../frontend relative to this file.
$frontendDir = is_dir('/app/frontend') ? '/app/frontend' : __DIR__ . '/../../frontend';
$filePath = $frontendDir . ($uri === '/' ? '/index.html' : $uri);
if (file_exists($filePath) && is_file($filePath)) {
    $ext = pathinfo($filePath, PATHINFO_EXTENSION);
    $types = ['html' => 'text/html', 'css' => 'text/css', 'js' => 'application/javascript'];
    header('Content-Type: ' . ($types[$ext] ?? 'application/octet-stream'));
    readfile($filePath);
} else {
    http_response_code(404);
    echo "Not found";
}
