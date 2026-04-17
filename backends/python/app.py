# =============================================================================
# NetAPI Quickstart — Python Backend
#
# This server does two things:
# 1. Serves the LendSafe demo frontend (the bank UI)
# 2. Handles SIM Swap verification requests by talking to NetAPI
#
# The flow for each verification request:
#   1. CIBA Authentication: Ask NetAPI to authenticate a phone number
#   2. Token Polling: Wait for the operator to approve the authentication
#   3. SIM Swap Check: Use the token to check if the SIM was recently swapped
#   4. Return the result + a full trace log to the frontend
# =============================================================================

import os
import time
import json
import requests
from flask import Flask, request, jsonify, send_from_directory
from dotenv import load_dotenv

load_dotenv()

# In Docker: mounted at /app/frontend. Natively: ../../frontend relative to this file.
_frontend = '/app/frontend' if os.path.exists('/app/frontend') else os.path.join(os.path.dirname(__file__), '..', '..', 'frontend')
app = Flask(__name__, static_folder=_frontend)

# ---------------------------------------------------------------------------
# Configuration — these come from your .env file
# ---------------------------------------------------------------------------
NETAPI_BASE_URL = os.getenv('NETAPI_BASE_URL', 'https://api.netapi.africa')
NETAPI_CLIENT_ID = os.getenv('NETAPI_CLIENT_ID')
NETAPI_CLIENT_SECRET = os.getenv('NETAPI_CLIENT_SECRET')

if not NETAPI_CLIENT_ID or not NETAPI_CLIENT_SECRET:
    print('\n  Missing credentials!\n')
    print('  Open the .env file in this folder and paste your credentials:')
    print('    NETAPI_CLIENT_ID=your_client_id_here')
    print('    NETAPI_CLIENT_SECRET=your_secret_here\n')
    print('  Get them from: https://api.netapi.africa → Dashboard → Getting Started\n')
    exit(1)


# Serve the frontend
@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')


# ---------------------------------------------------------------------------
# POST /api/check-sim-swap
# ---------------------------------------------------------------------------
@app.route('/api/check-sim-swap', methods=['POST'])
def check_sim_swap():
    data = request.get_json()
    phone_number = data.get('phoneNumber')
    trace = []

    def log(entry_type, message, detail=None):
        entry = {'type': entry_type, 'message': message}
        if detail:
            entry['detail'] = detail
        trace.append(entry)

    try:
        # =================================================================
        # STEP 1: CIBA Authentication
        #
        # CIBA = Client-Initiated Backchannel Authentication
        # We tell NetAPI which phone number to authenticate.
        # NetAPI forwards this to the mobile operator (e.g. Safaricom).
        # The operator verifies the number on their network.
        # =================================================================

        log('request', f'POST {NETAPI_BASE_URL}/oauth/bc-authorize', {
            'title': 'CIBA Authentication Request',
            'body': {
                'login_hint': f'tel:{phone_number}',
                'scope': 'openid dpv:FraudPreventionAndDetection sim-swap:check',
                'client_id': NETAPI_CLIENT_ID,
                'client_secret': '***hidden***'
            }
        })

        ciba_resp = requests.post(
            f'{NETAPI_BASE_URL}/oauth/bc-authorize',
            data={
                'login_hint': f'tel:{phone_number}',
                'scope': 'openid dpv:FraudPreventionAndDetection sim-swap:check',
                'client_id': NETAPI_CLIENT_ID,
                'client_secret': NETAPI_CLIENT_SECRET
            },
            headers={'Content-Type': 'application/x-www-form-urlencoded'}
        )

        ciba_data = ciba_resp.json()

        if ciba_resp.status_code != 200 or 'auth_req_id' not in ciba_data:
            log('error', f'CIBA failed: {ciba_resp.status_code} — {ciba_data.get("error", "Unknown")}', {
                'title': 'CIBA Error Response',
                'body': ciba_data
            })
            return jsonify({
                'success': False,
                'error': ciba_data.get('error_description', ciba_data.get('error', 'Authentication failed')),
                'errorDetail': 'Check your client_id and client_secret in .env',
                'trace': trace
            })

        auth_req_id = ciba_data['auth_req_id']
        log('response', f'200 OK — auth_req_id: {auth_req_id[:16]}...', {
            'title': 'CIBA Response',
            'body': {
                'auth_req_id': auth_req_id,
                'expires_in': ciba_data.get('expires_in'),
                'interval': ciba_data.get('interval')
            }
        })

        # =================================================================
        # STEP 2: Poll for Token
        #
        # The operator needs time to verify the phone number.
        # We poll until we get a token or time out.
        # =================================================================

        poll_interval = ciba_data.get('interval', 5)
        max_attempts = 6
        access_token = None

        for attempt in range(1, max_attempts + 1):
            log('info', f'Polling for token (attempt {attempt}/{max_attempts})...')

            wait_time = 2 if attempt == 1 else poll_interval
            time.sleep(wait_time)

            log('request', f'POST {NETAPI_BASE_URL}/oauth/token', {
                'title': f'Token Poll Request (attempt {attempt})',
                'body': {
                    'grant_type': 'urn:openid:params:grant-type:ciba',
                    'auth_req_id': auth_req_id,
                    'client_id': NETAPI_CLIENT_ID
                }
            })

            token_resp = requests.post(
                f'{NETAPI_BASE_URL}/oauth/token',
                data={
                    'grant_type': 'urn:openid:params:grant-type:ciba',
                    'auth_req_id': auth_req_id,
                    'client_id': NETAPI_CLIENT_ID,
                    'client_secret': NETAPI_CLIENT_SECRET
                },
                headers={'Content-Type': 'application/x-www-form-urlencoded'}
            )

            token_data = token_resp.json()

            if 'access_token' in token_data:
                access_token = token_data['access_token']
                log('response', f'200 OK — Token received ({access_token[:20]}...)', {
                    'title': 'Token Response',
                    'body': {
                        'access_token': access_token[:30] + '...',
                        'token_type': token_data.get('token_type'),
                        'expires_in': token_data.get('expires_in'),
                        'scope': token_data.get('scope')
                    }
                })
                break
            elif token_data.get('error') == 'authorization_pending':
                log('info', 'Authorization pending — operator is processing...')
            else:
                log('error', f'Token request failed: {token_data.get("error")}', {
                    'title': 'Token Error',
                    'body': token_data
                })
                return jsonify({
                    'success': False,
                    'error': token_data.get('error_description', token_data.get('error', 'Token failed')),
                    'trace': trace
                })

        if not access_token:
            log('error', f'Timed out waiting for token after {max_attempts} attempts')
            return jsonify({
                'success': False,
                'error': 'Authentication timed out. The operator did not respond in time.',
                'errorDetail': 'This can happen with test numbers that simulate timeout scenarios.',
                'trace': trace
            })

        # =================================================================
        # STEP 3: Call the SIM Swap API
        #
        # We have an access token proving the phone was authenticated.
        # Now we call the SIM Swap Check endpoint.
        # =================================================================

        log('request', f'POST {NETAPI_BASE_URL}/sim-swap/v2/check', {
            'title': 'SIM Swap Check Request',
            'body': {
                'phoneNumber': phone_number,
                'authorization': f'Bearer {access_token[:20]}...'
            }
        })

        swap_resp = requests.post(
            f'{NETAPI_BASE_URL}/sim-swap/v2/check',
            headers={
                'Authorization': f'Bearer {access_token}',
                'Content-Type': 'application/json'
            },
            json={'phoneNumber': phone_number}
        )

        swap_data = swap_resp.json()

        if swap_resp.status_code != 200:
            log('error', f'SIM Swap check failed: {swap_resp.status_code}', {
                'title': 'SIM Swap Error Response',
                'body': swap_data
            })
            return jsonify({
                'success': False,
                'error': swap_data.get('message', swap_data.get('error', 'SIM Swap check failed')),
                'errorDetail': f'HTTP {swap_resp.status_code}',
                'trace': trace
            })

        log('response', f'200 OK — swapped: {swap_data.get("swapped")}', {
            'title': 'SIM Swap Check Response',
            'body': swap_data
        })

        latest = swap_data.get('latestSimChange')
        return jsonify({
            'success': True,
            'swapped': swap_data.get('swapped'),
            'swapAge': f'on {latest[:10]}' if latest else None,
            'trace': trace
        })

    except requests.exceptions.ConnectionError as e:
        log('error', f'Connection failed: {str(e)}')
        log('info', 'Check that NETAPI_BASE_URL is correct in your .env file')
        return jsonify({
            'success': False,
            'error': 'Could not connect to NetAPI',
            'errorDetail': 'Check your internet connection and NETAPI_BASE_URL in .env',
            'trace': trace
        })
    except Exception as e:
        log('error', f'Unexpected error: {str(e)}')
        return jsonify({
            'success': False,
            'error': str(e),
            'trace': trace
        })


# ---------------------------------------------------------------------------
# Start the server
# ---------------------------------------------------------------------------
if __name__ == '__main__':
    print('')
    print('  ============================================')
    print('  LendSafe — NetAPI SIM Swap Quickstart')
    print('  ============================================')
    print('')
    print(f'  App running at:    http://localhost:3000')
    print(f'  NetAPI endpoint:   {NETAPI_BASE_URL}')
    print(f'  Client ID:         {NETAPI_CLIENT_ID[:12]}...')
    print('')
    print('  Open the URL above in your browser.')
    print('')

    app.run(host='0.0.0.0', port=3000, debug=False)
