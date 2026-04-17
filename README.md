# NetAPI Quickstart — LendSafe SIM Swap Demo

A ready-to-run demo app that shows how to use NetAPI's SIM Swap API in a real-world scenario: a bank verifying a customer's phone number before approving a loan.

**What you'll see:** A bank loan portal that checks if a customer's SIM card was recently swapped (a fraud signal) before disbursing funds. The app shows the full API flow in a real-time trace panel so you can see every request and response.

## Quick Start

### Option 1: Docker (recommended — zero dependency issues)

```bash
# 1. Clone the repo
git clone https://github.com/NetAPI-Telecom/solid_puncake.git
cd solid_puncake

# 2. Create your .env file from the template
cp .env.example .env

# 3. Open .env in your editor and paste your credentials
#    Get them from: https://api.netapi.africa → Dashboard → Getting Started
#    Fill in NETAPI_CLIENT_ID and NETAPI_CLIENT_SECRET

# 4. Run (pick your language)
docker compose up node       # Node.js
docker compose up python     # Python
docker compose up php        # PHP
docker compose up go         # Go
docker compose up java       # Java

# 5. Open http://localhost:3000 in your browser
```

### Option 2: Run natively

Pick your language and follow the instructions below.

#### Node.js
```bash
cd backends/node
cp .env.example .env          # Create your .env from the template
# Open .env and paste your Client ID and Client Secret
npm install
npm start
# Open http://localhost:3000
```

#### Python
```bash
cd backends/python
cp .env.example .env          # Create your .env from the template
# Open .env and paste your Client ID and Client Secret
pip install -r requirements.txt
python app.py
# Open http://localhost:3000
```

#### PHP
```bash
cd backends/php
cp .env.example .env          # Create your .env from the template
# Open .env and paste your Client ID and Client Secret
php -S localhost:3000 index.php
# Open http://localhost:3000
```

#### Go
```bash
cd backends/go
cp .env.example .env          # Create your .env from the template
# Open .env and paste your Client ID and Client Secret
go run main.go
# Open http://localhost:3000
```

#### Java
```bash
cd backends/java
cp .env.example .env          # Create your .env from the template
# Open .env and paste your Client ID and Client Secret
java src/App.java
# Open http://localhost:3000
```

## Configuration

All backends use the same three environment variables (in your `.env` file):

| Variable | Description | Where to find it |
|----------|-------------|-----------------|
| `NETAPI_CLIENT_ID` | Your app's Client ID | NetAPI Dashboard → Getting Started → Step 3 |
| `NETAPI_CLIENT_SECRET` | Your app's Client Secret | NetAPI Dashboard → Getting Started → Step 3 (click the eye icon to reveal) |
| `NETAPI_BASE_URL` | NetAPI gateway URL | Already set to `https://api.netapi.africa` — no change needed |

## Test Phone Numbers

Use these numbers in the app to see different scenarios:

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
   |  1. Get Token              |                            |
   |  (client_id + secret)      |                            |
   |--------------------------->|                            |
   |  <- access_token           |                            |
   |<---------------------------|                            |
   |                            |                            |
   |  2. SIM Swap Check         |                            |
   |  (phone + token)           |                            |
   |--------------------------->|  Check SIM swap status     |
   |                            |--------------------------->|
   |                            |<---------------------------|
   |  <- swapped: true/false    |                            |
   |<---------------------------|                            |
```

## Project Structure

```
solid_puncake/
  frontend/              # Shared UI (single HTML file, all backends serve it)
    index.html           # LendSafe bank demo with trace panel
  backends/
    node/                # Node.js (Express)
      .env.example       # ← copy this to .env and add your credentials
      server.js          # The backend code (heavily commented)
    python/              # Python (Flask)
      .env.example
      app.py
    php/                 # PHP (built-in server)
      .env.example
      index.php
    go/                  # Go (net/http)
      .env.example
      main.go
    java/                # Java (com.sun.net.httpserver, zero deps)
      .env.example
      src/App.java
  docker-compose.yml     # Run any backend with: docker compose up <language>
  .env.example           # ← copy this to .env for Docker (shared by all services)
  README.md              # This file
```

## What This Teaches You

1. **Client Credentials Auth** — How to get an access token using your app's credentials
2. **SIM Swap API** — How to check if a SIM was recently swapped and interpret the result
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
