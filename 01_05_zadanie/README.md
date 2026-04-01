# 01_05_zadanie — Railway Spec-Driven Agent

Autonomous LLM agent that solves AG3NTS task `railway` by discovering the API at runtime, executing actions through native tools, and obtaining the final flag in format `{FLG:...}`.

The implementation intentionally follows the same architecture and conventions as `01_04_zadanie`:
- same app/agent/tool split
- same tracer style and session flow
- same MCP + native tool execution model
- same workspace-first logging and artifacts

## Architecture

```
app.js                          # Entrypoint: session + tracer + MCP + agent run
├── src/agent.js                # Orchestration loop (LLM ↔ tools, max 60 steps)
├── src/config.js               # Task config + system instructions
├── src/helpers/
│   ├── api.js                  # Responses API calls (chat/vision) + tracing
│   ├── railway-http.js         # Resilient verify HTTP client (503/backoff/rate limits)
│   ├── logger.js               # Console logger (verbose mode)
│   ├── response.js             # Response text extraction helper
│   ├── stats.js                # Token usage counters
│   └── shutdown.js             # Graceful process shutdown hooks
├── src/mcp/
│   └── client.js               # MCP stdio client (files server)
├── src/native/
│   └── tools.js                # Railway native tools + handlers
└── src/services/
    ├── trace-logger.js         # Per-run event recorder
    └── session-manager.js      # Session create/update/close
```

## Native tools

- `railway_api_call`
  - Calls `POST https://hub.ag3nts.org/verify` with:
    - `apikey` (from env)
    - `task: "railway"`
    - `answer` (provided by the model)
  - Reliability controls:
    - retries transient failures (`503`, `429`, `408`, network/timeout)
    - exponential backoff + jitter
    - honors `Retry-After` and common rate-limit reset headers
    - persists each attempt to `workspace/railway-logs/`
  - Includes duplicate-payload guard to reduce useless loops.

- `railway_update_state`
  - Merges discovered spec facts into `workspace/notes/railway-state.json`.

- `railway_list_recent_calls`
  - Returns compact summaries from recent `railway-logs` entries for reasoning/debugging.

## Spec-driven workflow

The agent is instructed to follow runtime documentation:

1. **First API call must be help** (`answer` with action `help`)
2. Parse help response as source of truth
3. Persist stable facts with `railway_update_state`
4. Execute only discovered actions/arguments in correct order
5. Stop when flag `{FLG:...}` is detected

No speculative action sequence is hardcoded.

## Workspace outputs

```
workspace/
├── railway-logs/              # Full request/response snapshots per API call
├── notes/
│   └── railway-state.json     # Merged runtime spec notes
├── sessions/                  # Session metadata and post-run insights
└── traces/                    # Full trace timeline (events)
```

## Trace events

Important event families:

- `app.*` - startup/shutdown/session lifecycle
- `agent.*` - loop steps and tool dispatch/results
- `llm.*` - model request/response/error
- `tool.*` - native tool start/result/error
- `railway.http.*` - retry attempts, response errors, backoff waits
- `verify.result` - normalized verification outcome

## Run

```bash
npm install
npm start
```

Verbose mode:

```bash
VERBOSE=true npm start
```

PowerShell:

```powershell
$env:VERBOSE="true"; node app.js
```

## Required environment

Set in the repository root `.env`:

- `AG3NTS_API_KEY` - required for verify endpoint
- AI provider key(s) used by shared root `config.js` (`OPENAI_API_KEY` or `OPENROUTER_API_KEY`)

## Notes

- This project prioritizes observability and reliability for agentic execution.
- Session and trace files are designed to make each run auditable end-to-end.
