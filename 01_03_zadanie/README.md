# 01_03_zadanie — Package Proxy Agent

HTTP agent that lets operators manage packages via natural language. Uses LLM + tool calling loop.

## Setup

```bash
npm install
```

Copy `.env.example` to the repo root `.env` (already exists) and fill in:

```
PACKAGES_API_URL=https://...   # base URL of the external packages API
AG3NTS_API_KEY=...             # authorization key for the packages API
```

The LLM keys (`OPENROUTER_API_KEY` / `OPENAI_API_KEY`) are already read from the root `.env`.

## Run

```bash
npm run dev      # with --watch (auto-restart on file change)
npm start        # plain node
```

## Endpoint

```
POST /
Content-Type: application/json

{ "sessionID": "any-string", "msg": "operator message" }
→ { "msg": "agent reply" }
```

## Debug files

| File | Contents |
|------|----------|
| `sessions/<sessionID>.json` | Full conversation history for a session (grows per turn) |
| `traces/<sessionID>-<timestamp>.json` | Detailed execution trace for one request (LLM calls, tool calls, timing) |

## Test without LLM (adapters only)

```bash
node --input-type=module <<'EOF'
import { checkPackage } from "./src/checkPackage.js";
import { redirectPackage } from "./src/redirectPackage.js";

// requires PACKAGES_API_URL and AG3NTS_API_KEY in env
console.log(await checkPackage("PKG-001"));
console.log(await redirectPackage("PKG-007", "WRO-01", "AUTH123"));
EOF
```

Or as a one-liner in PowerShell:

```powershell
node -e "
import('./src/checkPackage.js').then(m => m.checkPackage('PKG-001')).then(console.log).catch(console.error)
"
```
