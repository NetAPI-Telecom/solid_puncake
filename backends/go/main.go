// =============================================================================
// NetAPI Quickstart — Go Backend
//
// This server does two things:
// 1. Serves the LendSafe demo frontend (the bank UI)
// 2. Handles SIM Swap verification requests by talking to NetAPI
//
// Run with: go run main.go
// =============================================================================

package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

var (
	netapiBaseURL    string
	netapiClientID   string
	netapiClientSecret string
)

type TraceEntry struct {
	Type    string      `json:"type"`
	Message string      `json:"message"`
	Detail  interface{} `json:"detail,omitempty"`
}

type CheckRequest struct {
	PhoneNumber string `json:"phoneNumber"`
}

type CheckResponse struct {
	Success     bool         `json:"success"`
	Swapped     *bool        `json:"swapped,omitempty"`
	SwapAge     string       `json:"swapAge,omitempty"`
	Error       string       `json:"error,omitempty"`
	ErrorDetail string       `json:"errorDetail,omitempty"`
	Trace       []TraceEntry `json:"trace"`
}

func main() {
	godotenv.Load()

	netapiBaseURL = os.Getenv("NETAPI_BASE_URL")
	if netapiBaseURL == "" {
		netapiBaseURL = "https://api.netapi.africa"
	}
	netapiClientID = os.Getenv("NETAPI_CLIENT_ID")
	netapiClientSecret = os.Getenv("NETAPI_CLIENT_SECRET")

	if netapiClientID == "" || netapiClientSecret == "" {
		fmt.Println("\n  Missing credentials!")
		fmt.Println("  Edit .env with your NETAPI_CLIENT_ID and NETAPI_CLIENT_SECRET")
		fmt.Println("  Get them from: https://api.netapi.africa → Dashboard → Getting Started\n")
		os.Exit(1)
	}

	// In Docker: mounted at /app/frontend. Natively: ../../frontend relative to binary.
	frontendDir := "../../frontend"
	if _, err := os.Stat("/app/frontend"); err == nil {
		frontendDir = "/app/frontend"
	}
	http.Handle("/", http.FileServer(http.Dir(frontendDir)))

	// API endpoint
	http.HandleFunc("/api/check-sim-swap", handleCheckSimSwap)

	fmt.Println("")
	fmt.Println("  ============================================")
	fmt.Println("  LendSafe — NetAPI SIM Swap Quickstart")
	fmt.Println("  ============================================")
	fmt.Println("")
	fmt.Printf("  App running at:    http://localhost:3000\n")
	fmt.Printf("  NetAPI endpoint:   %s\n", netapiBaseURL)
	fmt.Printf("  Client ID:         %s...\n", netapiClientID[:12])
	fmt.Println("")

	log.Fatal(http.ListenAndServe(":3000", nil))
}

func handleCheckSimSwap(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", 405)
		return
	}

	var req CheckRequest
	json.NewDecoder(r.Body).Decode(&req)

	var trace []TraceEntry
	addTrace := func(t, msg string, detail interface{}) {
		entry := TraceEntry{Type: t, Message: msg, Detail: detail}
		trace = append(trace, entry)
	}

	respond := func(resp CheckResponse) {
		resp.Trace = trace
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}

	// =================================================================
	// STEP 1: CIBA Authentication
	// =================================================================
	addTrace("request", fmt.Sprintf("POST %s/oauth/bc-authorize", netapiBaseURL), map[string]interface{}{
		"title": "CIBA Authentication Request",
		"body": map[string]string{
			"login_hint":    "tel:" + req.PhoneNumber,
			"scope":         "openid dpv:FraudPreventionAndDetection sim-swap:check",
			"client_id":     netapiClientID,
			"client_secret": "***hidden***",
		},
	})

	cibaData := url.Values{
		"login_hint":    {"tel:" + req.PhoneNumber},
		"scope":         {"openid dpv:FraudPreventionAndDetection sim-swap:check"},
		"client_id":     {netapiClientID},
		"client_secret": {netapiClientSecret},
	}

	cibaResp, err := http.Post(netapiBaseURL+"/oauth/bc-authorize", "application/x-www-form-urlencoded", strings.NewReader(cibaData.Encode()))
	if err != nil {
		addTrace("error", "Connection failed: "+err.Error(), nil)
		respond(CheckResponse{Error: "Could not connect to NetAPI"})
		return
	}
	defer cibaResp.Body.Close()

	var cibaResult map[string]interface{}
	json.NewDecoder(cibaResp.Body).Decode(&cibaResult)

	authReqID, ok := cibaResult["auth_req_id"].(string)
	if !ok || cibaResp.StatusCode != 200 {
		addTrace("error", fmt.Sprintf("CIBA failed: %d", cibaResp.StatusCode), map[string]interface{}{
			"title": "CIBA Error", "body": cibaResult,
		})
		errMsg, _ := cibaResult["error_description"].(string)
		if errMsg == "" {
			errMsg = "Authentication failed"
		}
		respond(CheckResponse{Error: errMsg})
		return
	}

	addTrace("response", fmt.Sprintf("200 OK — auth_req_id: %s...", authReqID[:16]), nil)

	// =================================================================
	// STEP 2: Poll for Token
	// =================================================================
	var accessToken string
	pollInterval := 5
	if iv, ok := cibaResult["interval"].(float64); ok {
		pollInterval = int(iv)
	}

	for attempt := 1; attempt <= 6; attempt++ {
		addTrace("info", fmt.Sprintf("Polling for token (attempt %d/6)...", attempt), nil)

		if attempt == 1 {
			time.Sleep(2 * time.Second)
		} else {
			time.Sleep(time.Duration(pollInterval) * time.Second)
		}

		addTrace("request", fmt.Sprintf("POST %s/oauth/token", netapiBaseURL), nil)

		tokenData := url.Values{
			"grant_type":    {"urn:openid:params:grant-type:ciba"},
			"auth_req_id":   {authReqID},
			"client_id":     {netapiClientID},
			"client_secret": {netapiClientSecret},
		}

		tokenResp, err := http.Post(netapiBaseURL+"/oauth/token", "application/x-www-form-urlencoded", strings.NewReader(tokenData.Encode()))
		if err != nil {
			addTrace("error", "Token poll failed: "+err.Error(), nil)
			continue
		}

		var tokenResult map[string]interface{}
		json.NewDecoder(tokenResp.Body).Decode(&tokenResult)
		tokenResp.Body.Close()

		if tok, ok := tokenResult["access_token"].(string); ok {
			accessToken = tok
			addTrace("response", fmt.Sprintf("200 OK — Token received (%s...)", tok[:20]), nil)
			break
		} else if tokenResult["error"] == "authorization_pending" {
			addTrace("info", "Authorization pending — operator is processing...", nil)
		} else {
			addTrace("error", fmt.Sprintf("Token failed: %v", tokenResult["error"]), nil)
			respond(CheckResponse{Error: "Token request failed"})
			return
		}
	}

	if accessToken == "" {
		addTrace("error", "Timed out waiting for token", nil)
		respond(CheckResponse{Error: "Authentication timed out"})
		return
	}

	// =================================================================
	// STEP 3: Call the SIM Swap API
	// =================================================================
	addTrace("request", fmt.Sprintf("POST %s/sim-swap/v2/check", netapiBaseURL), map[string]interface{}{
		"title": "SIM Swap Check Request",
		"body":  map[string]string{"phoneNumber": req.PhoneNumber},
	})

	swapBody, _ := json.Marshal(map[string]string{"phoneNumber": req.PhoneNumber})
	swapReq, _ := http.NewRequest("POST", netapiBaseURL+"/sim-swap/v2/check", bytes.NewReader(swapBody))
	swapReq.Header.Set("Authorization", "Bearer "+accessToken)
	swapReq.Header.Set("Content-Type", "application/json")

	swapResp, err := http.DefaultClient.Do(swapReq)
	if err != nil {
		addTrace("error", "SIM Swap request failed: "+err.Error(), nil)
		respond(CheckResponse{Error: "SIM Swap check failed"})
		return
	}
	defer swapResp.Body.Close()

	swapBodyBytes, _ := io.ReadAll(swapResp.Body)
	var swapResult map[string]interface{}
	json.Unmarshal(swapBodyBytes, &swapResult)

	if swapResp.StatusCode != 200 {
		addTrace("error", fmt.Sprintf("SIM Swap failed: %d", swapResp.StatusCode), map[string]interface{}{
			"title": "Error", "body": swapResult,
		})
		respond(CheckResponse{Error: "SIM Swap check failed"})
		return
	}

	swapped, _ := swapResult["swapped"].(bool)
	addTrace("response", fmt.Sprintf("200 OK — swapped: %v", swapped), map[string]interface{}{
		"title": "SIM Swap Response", "body": swapResult,
	})

	var swapAge string
	if latest, ok := swapResult["latestSimChange"].(string); ok && latest != "" {
		swapAge = "on " + latest[:10]
	}

	respond(CheckResponse{Success: true, Swapped: &swapped, SwapAge: swapAge})
}
