# 01_03_zadanie — Package Proxy Agent

HTTP agent that lets operators manage packages via natural language.
Uses LLM + tool calling loop with a deterministic mission rule guard.

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
