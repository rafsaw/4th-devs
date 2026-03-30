# 01_03_zadanie — Package Proxy Agent

HTTP agent that lets operators manage packages via natural language.
Uses LLM + tool calling loop with a deterministic mission rule guard.

---

## Full submission sequence (end-to-end)

This is the exact order of steps every time you want to run the task:

### Step 1 — start local server

```bash
cd 01_03_zadanie
npm run dev
```

Verify it started:
```
[missionRules] loaded — 23 keywords active
Proxy agent listening on http://localhost:3000
```

---

### Step 2 — expose publicly via ngrok

#### Install ngrok (first time only)

Download from https://ngrok.com/download and unzip, then add to PATH.
Or install via Chocolatey:
```powershell
choco install ngrok
```

#### Start ngrok

Open a **new PowerShell terminal** (keep server terminal open):

```powershell
ngrok http 3000
```

Ngrok prints a dashboard like this:
```
Session Status    online
Account           your@email.com
Version           3.x.x
Region            Europe (eu)
Forwarding        https://69ec-98-213-244-242.ngrok-free.app -> http://localhost:3000
```

**Copy the `https://` Forwarding URL** — you need it in Step 3.

#### Get the URL from command line (without reading the dashboard)

If you want to grab the URL automatically:

```powershell
# Wait a moment for ngrok to start, then:
(Invoke-RestMethod http://localhost:4040/api/tunnels).tunnels[0].public_url
```

This calls ngrok's local API (port 4040) and prints just the URL.

> **Important:** free ngrok URL changes every time you restart ngrok.
> Always copy the fresh URL and re-run Step 3 after each restart.

---

### Step 3 — register with Hub (trigger operator session)

Send a POST to the verify endpoint. Replace `YOUR-NGROK-URL` with the URL from Step 2.

```powershell
$ngrokUrl = (Invoke-RestMethod http://localhost:4040/api/tunnels).tunnels[0].public_url

Invoke-RestMethod -Uri https://hub.ag3nts.org/verify `
  -Method POST -ContentType "application/json" `
  -Body (@{
    apikey  = "4999b7d1-5386-4349-a80b-d4a2a481116f"
    task    = "proxy"
    answer  = @{
      url       = $ngrokUrl
      sessionID = "rafsaw-session-007"
    }
  } | ConvertTo-Json -Depth 3)
```

Or paste the URL manually if you prefer:

```powershell
Invoke-RestMethod -Uri https://hub.ag3nts.org/verify `
  -Method POST -ContentType "application/json" `
  -Body '{
    "apikey": "4999b7d1-5386-4349-a80b-d4a2a481116f",
    "task": "proxy",
    "answer": {
      "url": "https://PASTE-YOUR-NGROK-URL-HERE.ngrok-free.app",
      "sessionID": "rafsaw-session-007"
    }
  }'
```

**What Hub does after this:**
- Sends operator messages to `POST YOUR-NGROK-URL/` with `{ sessionID, msg }`
- Your server handles them, agent responds
- Hub evaluates whether the mission rule was executed correctly

---

### Step 4 — monitor the conversation

Watch the local server console for real-time logs:
```
→ [your-session-id] <operator message>
← [your-session-id] <agent reply> (1234ms)
```

Check the session file to see conversation + guard decisions:
```bash
# Windows
type sessions\your-session-id.json

# or just open in editor
```

The mission rule working correctly looks like this in the session file:
```json
{ "type": "missionRules.check",   "triggered": true, "matchedKeywords": ["rdzenie", "elektrown"] },
{ "type": "missionRules.override", "originalDestination": "PWR3847PL", "forcedDestination": "PWR6132PL" }
```

And in `function_call_output` you should see `"destination":"PWR6132PL"` — that's the proof the redirect went to the right place.

---

### Summary — 3 terminal setup

| Terminal | Command | Purpose |
|---|---|---|
| 1 | `npm run dev` in `01_03_zadanie/` | Local agent server |
| 2 | `ngrok http 3000` | Public tunnel |
| 3 | PowerShell / curl | Send verify POST to Hub |

---

## Requirements

- Node.js >= 24
- Access to OpenRouter (or OpenAI) API
- Access to the external packages API (`https://hub.ag3nts.org/api/packages`)

---

## Environment variables

Copy `.env.example` to `.env` and fill in the values:

| Variable | Required | Description |
|---|---|---|
| `OPENROUTER_API_KEY` | yes | OpenRouter key (or use `OPENAI_API_KEY`) |
| `AI_PROVIDER` | yes | `openrouter` or `openai` |
| `PACKAGES_API_URL` | yes | `https://hub.ag3nts.org/api/packages` |
| `AG3NTS_API_KEY` | yes | Key for the packages API |
| `PORT` | no | HTTP port, default `3000` |

> The LLM keys are read from the root `.env` via `../../config.js`.
> The packages API key lives in `01_03_zadanie/.env`.

---

## Run locally

```bash
cd 01_03_zadanie
npm install
npm run dev        # node --watch (auto-restart on file change)
# or
npm start          # plain node
```

Server starts at `http://localhost:3000`.

---

## Endpoint

```
POST /
Content-Type: application/json

{
  "sessionID": "any-string-you-choose",
  "msg":       "operator message"
}
```

Response (always this shape):

```json
{ "msg": "agent reply" }
```

---

## Test with curl

Basic message:
```bash
curl -X POST http://localhost:3000/ \
  -H "Content-Type: application/json" \
  -d '{"sessionID":"s1","msg":"cześć"}'
```

Check a package:
```bash
curl -X POST http://localhost:3000/ \
  -H "Content-Type: application/json" \
  -d '{"sessionID":"s1","msg":"sprawdź paczkę PKG12345678"}'
```

Redirect (normal):
```bash
curl -X POST http://localhost:3000/ \
  -H "Content-Type: application/json" \
  -d '{"sessionID":"s1","msg":"przekieruj PKG12345678 do WRO-01, kod AUTH99"}'
```

Redirect (reactor parts — triggers mission rule):
```bash
curl -X POST http://localhost:3000/ \
  -H "Content-Type: application/json" \
  -d '{"sessionID":"s2","msg":"przekieruj paczkę PKG-007 z częściami do reaktora na LOD-05, kod R-AUTH"}'
```

PowerShell equivalent:
```powershell
Invoke-RestMethod -Uri http://localhost:3000/ `
  -Method POST -ContentType "application/json" `
  -Body '{"sessionID":"s1","msg":"sprawdź paczkę PKG12345678"}'
```

---

## Expose publicly via ngrok

```bash
# install ngrok: https://ngrok.com/download
ngrok http 3000
```

Copy the `https://xxxx.ngrok-free.app` URL — use it as the public endpoint.

> Make sure the server is running locally before starting ngrok.

---

## Debug files (written after each request)

| Path | Contents |
|---|---|
| `sessions/<sessionID>.json` | Full conversation history for the session |
| `traces/<sessionID>-<timestamp>.json` | Detailed execution trace: LLM calls, tool calls, timing, mission rule guard |

---

## Pre-submission checklist

- [ ] Server starts without errors (`npm start`)
- [ ] `POST /` returns `{ "msg": "..." }` for a plain message
- [ ] `POST /` returns `{ "msg": "..." }` for a package check (tool call works)
- [ ] `POST /` returns `{ "msg": "..." }` with confirmation code for a redirect
- [ ] Reactor-parts redirect: `traces/` shows `missionRules.override` event with `forcedDestination: "PWR6132PL"`
- [ ] Session memory works: second message in same `sessionID` has context from first
- [ ] ngrok URL reachable from outside (test with phone/another machine)
- [ ] No API keys visible in logs or response bodies
- [ ] `PACKAGES_API_URL` points to `https://hub.ag3nts.org/api/packages` (not localhost)

---

## What most often breaks with a public URL

| Problem | Cause | Fix |
|---|---|---|
| `{"error":"Internal error"}` | LLM or packages API key missing/wrong | Check `.env`, restart server |
| Timeout from Hub | LLM response too slow (>30s) | Switch to faster model in `src/llm.js` |
| HTML instead of JSON from packages API | Wrong `PACKAGES_API_URL` | Verify env var, restart |
| `sessionID` context lost between requests | Different server instances behind ngrok | Use single process, no load balancer |
| ngrok 429 / rate limit | Free ngrok plan | Upgrade or use fixed domain |
| `Cannot POST /` (404) | Endpoint path mismatch | Confirm Hub sends to root `/`, not `/api/chat` |
