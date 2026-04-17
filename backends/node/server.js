// =============================================================================
// NetAPI Quickstart — Node.js Backend
//
// This server does two things:
// 1. Serves the LendSafe demo frontend (the bank UI)
// 2. Handles SIM Swap verification requests by talking to NetAPI
//
// The flow for each verification request:
//   1. CIBA Authentication: Ask NetAPI to authenticate a phone number
//   2. Token Polling: Wait for the operator to approve the authentication
//   3. SIM Swap Check: Use the token to check if the SIM was recently swapped
//   4. Return the result + a full trace log to the frontend
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
    // STEP 1: CIBA Authentication
    //
    // CIBA = Client-Initiated Backchannel Authentication
    // This tells NetAPI: "I want to authenticate this phone number"
    // NetAPI forwards the request to the mobile operator (e.g. Safaricom)
    // The operator verifies the phone number on their network
    //
    // We send:
    //   - login_hint: the phone number to authenticate (tel:+254...)
    //   - scope: what API we want to use (sim-swap:check)
    //   - client credentials: proves we are who we say we are
    //
    // We get back:
    //   - auth_req_id: a reference to track this authentication request
    //   - interval: how often to poll for the result (in seconds)
    //   - expires_in: how long the request is valid
    // =====================================================================

    log('request', `POST ${NETAPI_BASE_URL}/oauth/bc-authorize`, {
      title: 'CIBA Authentication Request',
      body: {
        login_hint: `tel:${phoneNumber}`,
        scope: 'openid dpv:FraudPreventionAndDetection sim-swap:check',
        client_id: NETAPI_CLIENT_ID,
        client_secret: '***hidden***'
      }
    });

    // Build the form-encoded body for CIBA
    // Note: the + in phone numbers must be encoded as %2B in form data
    const cibaBody = new URLSearchParams({
      login_hint: `tel:${phoneNumber}`,
      scope: 'openid dpv:FraudPreventionAndDetection sim-swap:check',
      client_id: NETAPI_CLIENT_ID,
      client_secret: NETAPI_CLIENT_SECRET
    });

    const cibaResponse = await fetch(`${NETAPI_BASE_URL}/oauth/bc-authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: cibaBody
    });

    const cibaData = await cibaResponse.json();

    if (!cibaResponse.ok || !cibaData.auth_req_id) {
      log('error', `CIBA failed: ${cibaResponse.status} — ${cibaData.error || 'Unknown error'}`, {
        title: 'CIBA Error Response',
        body: cibaData
      });
      return res.json({
        success: false,
        error: cibaData.error_description || cibaData.error || 'Authentication failed',
        errorDetail: 'Check your client_id and client_secret in .env',
        trace
      });
    }

    log('response', `200 OK — auth_req_id: ${cibaData.auth_req_id.substring(0, 16)}...`, {
      title: 'CIBA Response',
      body: {
        auth_req_id: cibaData.auth_req_id,
        expires_in: cibaData.expires_in,
        interval: cibaData.interval
      }
    });

    // =====================================================================
    // STEP 2: Poll for Token
    //
    // The operator needs time to verify the phone number on their network.
    // We poll the token endpoint with the auth_req_id until either:
    //   - We get an access token (success)
    //   - We get an error (failed)
    //   - We time out (too many attempts)
    //
    // The response tells us the status:
    //   - authorization_pending: still waiting, try again
    //   - access_token present: operator approved, here's your token
    //   - access_denied: operator rejected the request
    // =====================================================================

    const pollInterval = (cibaData.interval || 5) * 1000;
    const maxAttempts = 6;
    let accessToken = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      log('info', `Polling for token (attempt ${attempt}/${maxAttempts})...`);

      // Wait the specified interval before polling
      await new Promise(resolve => setTimeout(resolve, attempt === 1 ? 2000 : pollInterval));

      log('request', `POST ${NETAPI_BASE_URL}/oauth/token`, {
        title: `Token Poll Request (attempt ${attempt})`,
        body: {
          grant_type: 'urn:openid:params:grant-type:ciba',
          auth_req_id: cibaData.auth_req_id,
          client_id: NETAPI_CLIENT_ID
        }
      });

      const tokenBody = new URLSearchParams({
        grant_type: 'urn:openid:params:grant-type:ciba',
        auth_req_id: cibaData.auth_req_id,
        client_id: NETAPI_CLIENT_ID,
        client_secret: NETAPI_CLIENT_SECRET
      });

      const tokenResponse = await fetch(`${NETAPI_BASE_URL}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tokenBody
      });

      const tokenData = await tokenResponse.json();

      if (tokenData.access_token) {
        // Got the token — operator approved the authentication
        accessToken = tokenData.access_token;
        log('response', `200 OK — Token received (${accessToken.substring(0, 20)}...)`, {
          title: 'Token Response',
          body: {
            access_token: accessToken.substring(0, 30) + '...',
            token_type: tokenData.token_type,
            expires_in: tokenData.expires_in,
            scope: tokenData.scope
          }
        });
        break;
      } else if (tokenData.error === 'authorization_pending') {
        // Not ready yet — the operator is still processing
        log('info', 'Authorization pending — operator is processing...');
      } else {
        // Something went wrong
        log('error', `Token request failed: ${tokenData.error}`, {
          title: 'Token Error',
          body: tokenData
        });
        return res.json({
          success: false,
          error: tokenData.error_description || tokenData.error || 'Token request failed',
          trace
        });
      }
    }

    if (!accessToken) {
      log('error', 'Timed out waiting for token after ' + maxAttempts + ' attempts');
      return res.json({
        success: false,
        error: 'Authentication timed out. The operator did not respond in time.',
        errorDetail: 'This can happen with test numbers that simulate timeout scenarios.',
        trace
      });
    }

    // =====================================================================
    // STEP 3: Call the SIM Swap API
    //
    // Now we have an access token that proves the phone number was
    // authenticated by the mobile operator. We use this token to call
    // the SIM Swap Check API.
    //
    // We send:
    //   - phoneNumber: the number to check
    //   - Authorization header: Bearer token from step 2
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
