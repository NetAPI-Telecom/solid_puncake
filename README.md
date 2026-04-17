# NetAPI Quickstart — LendSafe SIM Swap Demo

A ready-to-run demo app that shows how to use NetAPI's SIM Swap API in a real-world scenario: a bank verifying a customer's phone number before approving a loan.

**What you'll see:** A bank loan portal that checks if a customer's SIM card was recently swapped (a fraud signal) before disbursing funds. The app shows the full API flow in a real-time trace panel so you can see every request and response.

## Quick Start

### Option 1: Docker (recommended — zero dependency issues)

```bash
# 1. Clone
git clone https://github.com/NetAPI-Telecom/solid_puncake.git
cd netapi-quickstart

# 2. Add your credentials to .env
#    Get them from: https://api.netapi.africa → Dashboard → Getting Started

# 3. Run (pick your language)
docker compose up node       # Node.js
docker compose up python     # Python
docker compose up php        # PHP
docker compose up go         # Go
docker compose up java       # Java

# 4. Open http://localhost:3000
```

### Option 2: Run natively

Pick your language and follow the instructions below.

#### Node.js
```bash
cd backends/node
# Edit .env with your credentials
npm install
npm start
# Open http://localhost:3000
```

#### Python
```bash
cd backends/python
# Edit .env with your credentials
pip install -r requirements.txt
python app.py
# Open http://localhost:3000
```

#### PHP
```bash
cd backends/php
# Edit .env with your credentials
php -S localhost:3000 index.php
# Open http://localhost:3000
```

#### Go
```bash
cd backends/go
# Edit .env with your credentials
go run main.go
# Open http://localhost:3000
```

#### Java
```bash
cd backends/java
# Edit .env with your credentials
java src/App.java
# Open http://localhost:3000
```

## Configuration

All backends use the same three environment variables:

| Variable | Description |
|----------|-------------|
| `NETAPI_CLIENT_ID` | Your app's Client ID from the NetAPI dashboard |
| `NETAPI_CLIENT_SECRET` | Your app's Client Secret from the NetAPI dashboard |
| `NETAPI_BASE_URL` | NetAPI gateway URL (default: `https://api.netapi.africa`) |

## Test Phone Numbers

| Number | Scenario | What happens |
|--------|----------|-------------|
| `+254712345678` | SIM not swapped | Loan approved — safe to disburse |
| `+254755555555` | SIM recently swapped | Loan held — fraud risk detected |
| `+254788888888` | Operator timeout | Shows how to handle timeouts gracefully |
| `+254777000000` | Device offline | Shows error handling for unreachable devices |

## How It Works

```
Your App                    NetAPI Gateway              Mobile Operator
   |                            |                            |
   |  1. CIBA Auth Request      |                            |
   |  (phone number + creds)    |                            |
   |--------------------------->|                            |
   |                            |  Forward to operator       |
   |                            |--------------------------->|
   |                            |                            |
   |                            |  Operator verifies phone   |
   |                            |<---------------------------|
   |  2. Poll for token         |                            |
   |--------------------------->|                            |
   |  <- access_token           |                            |
   |<---------------------------|                            |
   |                            |                            |
   |  3. SIM Swap Check         |                            |
   |  (phone + token)           |                            |
   |--------------------------->|  Check SIM swap status     |
   |                            |--------------------------->|
   |                            |<---------------------------|
   |  <- swapped: true/false    |                            |
   |<---------------------------|                            |
```

## Project Structure

```
netapi-quickstart/
  frontend/           # Shared UI (single HTML file, all backends serve it)
    index.html        # LendSafe bank demo with trace panel
  backends/
    node/             # Node.js (Express)
    python/           # Python (Flask)
    php/              # PHP (built-in server)
    go/               # Go (net/http)
    java/             # Java (com.sun.net.httpserver, zero deps)
  docker-compose.yml  # Run any backend with: docker compose up <language>
  .env                # Shared credentials for Docker
  README.md           # This file
```

## What This Teaches You

1. **CIBA Authentication** — How to authenticate a phone number through NetAPI without user interaction
2. **Token Polling** — How to wait for operator approval and handle pending states
3. **SIM Swap API** — How to check if a SIM was recently swapped and interpret the result
4. **Error Handling** — How to handle timeouts, offline devices, and API errors in your UI
5. **Real-World Integration** — How a bank (or any app) would integrate fraud checks into their workflow

## Next Steps

- Try other test numbers to see different scenarios
- Look at the trace panel to understand each API call
- Read the backend code — every step is commented
- Create your own app on [NetAPI](https://api.netapi.africa) and build something real

## Links

- [NetAPI Dashboard](https://api.netapi.africa)
- [API Documentation](https://docs.netapi.africa)
- [CAMARA APIs](https://camaraproject.org)
