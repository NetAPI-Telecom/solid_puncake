# =============================================================================
# NetAPI Quickstart — Python Backend
#
# This server does two things:
# 1. Serves the LendSafe demo frontend (the bank UI)
# 2. Handles SIM Swap verification requests by talking to NetAPI
#
# The flow for each verification request:
#   1. Client Credentials: Get an access token using your app's client_id + secret
#   2. SIM Swap Check: Use the token to check if the SIM was recently swapped
#   3. Return the result + a full trace log to the frontend
# =============================================================================

import os
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
        # STEP 1: Get an Access Token (Client Credentials)
        #
        # Client Credentials is the simplest OAuth2 flow — your server
        # authenticates directly with NetAPI using your app's client_id
        # and client_secret. No user interaction needed.
        #
        # This is the right flow when YOUR SERVER is making the check
        # on behalf of a customer (e.g., a bank checking before loan approval).
        # =================================================================

        log('request', f'POST {NETAPI_BASE_URL}/oauth/token', {
            'title': 'Token Request (Client Credentials)',
            'body': {
                'grant_type': 'client_credentials',
                'client_id': NETAPI_CLIENT_ID,
                'client_secret': '***hidden***',
                'scope': 'sim-swap:check'
            }
        })

        token_resp = requests.post(
            f'{NETAPI_BASE_URL}/oauth/token',
            data={
                'grant_type': 'client_credentials',
                'client_id': NETAPI_CLIENT_ID,
                'client_secret': NETAPI_CLIENT_SECRET,
                'scope': 'sim-swap:check'
            },
            headers={'Content-Type': 'application/x-www-form-urlencoded'}
        )

        token_data = token_resp.json()

        if token_resp.status_code != 200 or 'access_token' not in token_data:
            log('error', f'Token request failed: {token_resp.status_code} — {token_data.get("error", "Unknown")}', {
                'title': 'Token Error Response',
                'body': token_data
            })
            return jsonify({
                'success': False,
                'error': token_data.get('error_description', token_data.get('error', 'Authentication failed')),
                'errorDetail': 'Check your client_id and client_secret in .env',
                'trace': trace
            })

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

        # =================================================================
        # STEP 2: Call the SIM Swap API
        #
        # Now we have an access token. We use it to call the SIM Swap
        # Check endpoint with the customer's phone number.
        #
        # With client_credentials (2-legged) tokens, we send the phone
        # number in the request body — our server is telling NetAPI
        # which number to check.
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
