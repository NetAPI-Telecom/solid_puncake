// =============================================================================
// NetAPI Quickstart — Node.js Backend
//
// This server does two things:
// 1. Serves the LendSafe demo frontend (the bank UI)
// 2. Handles SIM Swap verification requests by talking to NetAPI
//
// The flow for each verification request:
//   1. Client Credentials: Get an access token using your app's client_id + secret
//   2. SIM Swap Check: Use the token to check if the SIM was recently swapped
//   3. Return the result + a full trace log to the frontend
//
// Every step is logged so the developer can see exactly what happens
// between their app and the NetAPI gateway.
// =============================================================================

const express = require('express');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());

// Serve the shared frontend
// In Docker: mounted at /app/frontend. Natively: ../../frontend relative to this file.
const frontendPath = require('fs').existsSync('/app/frontend')
  ? '/app/frontend'
  : path.join(__dirname, '..', '..', 'frontend');
app.use(express.static(frontendPath));

// ---------------------------------------------------------------------------
// Configuration — these come from your .env file
// ---------------------------------------------------------------------------
const NETAPI_BASE_URL = process.env.NETAPI_BASE_URL || 'https://api.netapi.africa';
const NETAPI_CLIENT_ID = process.env.NETAPI_CLIENT_ID;
const NETAPI_CLIENT_SECRET = process.env.NETAPI_CLIENT_SECRET;

// Check credentials on startup
if (!NETAPI_CLIENT_ID || !NETAPI_CLIENT_SECRET) {
  console.error('\n  Missing credentials!\n');
  console.error('  Open the .env file in this folder and paste your credentials:');
  console.error('    NETAPI_CLIENT_ID=your_client_id_here');
  console.error('    NETAPI_CLIENT_SECRET=your_secret_here\n');
  console.error('  Get them from: https://api.netapi.africa → Dashboard → Getting Started\n');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// POST /api/check-sim-swap
//
// The frontend sends: { "phoneNumber": "+254712345678" }
// We return: { success: true/false, swapped: true/false, trace: [...] }
//
// The trace array contains every HTTP request and response so the developer
// can see the full flow in the frontend's trace panel.
// ---------------------------------------------------------------------------
app.post('/api/check-sim-swap', async (req, res) => {
  const { phoneNumber } = req.body;
  const trace = [];

  // Helper: add a trace entry
  const log = (type, message, detail) => {
    trace.push({ type, message, ...(detail ? { detail } : {}) });
  };

  try {
    // =====================================================================
    // STEP 1: Get an Access Token (Client Credentials)
    //
    // Client Credentials is the simplest OAuth2 flow — your server
    // authenticates directly with NetAPI using your app's client_id
    // and client_secret. No user interaction needed.
    //
    // This is the right flow when YOUR SERVER is making the check
    // on behalf of a customer (e.g., a bank checking before loan approval).
    //
    // We send:
    //   - grant_type: "client_credentials" (server-to-server auth)
    //   - client_id + client_secret: your app's credentials from .env
    //   - scope: which API we want to use (sim-swap:check)
    //
    // We get back:
    //   - access_token: a short-lived token to call the API
    //   - expires_in: how long the token is valid (in seconds)
    // =====================================================================

    log('request', `POST ${NETAPI_BASE_URL}/oauth/token`, {
      title: 'Token Request (Client Credentials)',
      body: {
        grant_type: 'client_credentials',
        client_id: NETAPI_CLIENT_ID,
        client_secret: '***hidden***',
        scope: 'sim-swap:check'
      }
    });

    const tokenBody = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: NETAPI_CLIENT_ID,
      client_secret: NETAPI_CLIENT_SECRET,
      scope: 'sim-swap:check'
    });

    const tokenResponse = await fetch(`${NETAPI_BASE_URL}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.access_token) {
      log('error', `Token request failed: ${tokenResponse.status} — ${tokenData.error || 'Unknown error'}`, {
        title: 'Token Error Response',
        body: tokenData
      });
      return res.json({
        success: false,
        error: tokenData.error_description || tokenData.error || 'Authentication failed',
        errorDetail: 'Check your client_id and client_secret in .env',
        trace
      });
    }

    const accessToken = tokenData.access_token;
    log('response', `200 OK — Token received (${accessToken.substring(0, 20)}...)`, {
      title: 'Token Response',
      body: {
        access_token: accessToken.substring(0, 30) + '...',
        token_type: tokenData.token_type,
        expires_in: tokenData.expires_in,
        scope: tokenData.scope
      }
    });

    // =====================================================================
    // STEP 2: Call the SIM Swap API
    //
    // Now we have an access token. We use it to call the SIM Swap
    // Check endpoint with the customer's phone number.
    //
    // With client_credentials (2-legged) tokens, we send the phone
    // number in the request body — our server is telling NetAPI which
    // number to check.
    //
    // We send:
    //   - phoneNumber: the customer's number in E.164 format (+254...)
    //   - Authorization header: Bearer token from step 1
    //
    // We get back:
    //   - swapped: true/false — whether the SIM was recently changed
    //   - latestSimChange: when the last swap happened (if swapped)
    // =====================================================================

    log('request', `POST ${NETAPI_BASE_URL}/sim-swap/v2/check`, {
      title: 'SIM Swap Check Request',
      body: {
        phoneNumber: phoneNumber,
        authorization: `Bearer ${accessToken.substring(0, 20)}...`
      }
    });

    const simSwapResponse = await fetch(`${NETAPI_BASE_URL}/sim-swap/v2/check`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ phoneNumber })
    });

    const simSwapData = await simSwapResponse.json();

    if (!simSwapResponse.ok) {
      log('error', `SIM Swap check failed: ${simSwapResponse.status}`, {
        title: 'SIM Swap Error Response',
        body: simSwapData
      });
      return res.json({
        success: false,
        error: simSwapData.message || simSwapData.error || 'SIM Swap check failed',
        errorDetail: `HTTP ${simSwapResponse.status}`,
        trace
      });
    }

    log('response', `200 OK — swapped: ${simSwapData.swapped}`, {
      title: 'SIM Swap Check Response',
      body: simSwapData
    });

    // =====================================================================
    // Return the result to the frontend
    // =====================================================================

    return res.json({
      success: true,
      swapped: simSwapData.swapped,
      swapAge: simSwapData.latestSimChange
        ? `on ${new Date(simSwapData.latestSimChange).toLocaleDateString()}`
        : null,
      trace
    });

  } catch (error) {
    // Network errors, DNS failures, server unreachable, etc.
    log('error', `Request failed: ${error.message}`);
    log('info', 'Check that NETAPI_BASE_URL is correct in your .env file');

    return res.json({
      success: false,
      error: error.message,
      errorDetail: 'Network error — could not reach NetAPI. Check your internet connection and NETAPI_BASE_URL.',
      trace
    });
  }
});

// ---------------------------------------------------------------------------
// Start the server
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('');
  console.log('  ============================================');
  console.log('  LendSafe — NetAPI SIM Swap Quickstart');
  console.log('  ============================================');
  console.log('');
  console.log(`  App running at:    http://localhost:${PORT}`);
  console.log(`  NetAPI endpoint:   ${NETAPI_BASE_URL}`);
  console.log(`  Client ID:         ${NETAPI_CLIENT_ID.substring(0, 12)}...`);
  console.log('');
  console.log('  Open the URL above in your browser.');
  console.log('  Enter a phone number and click "Verify & Approve Loan".');
  console.log('');
});
