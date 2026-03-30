# 01_04_zadanie — Sendit Declaration Agent

An autonomous LLM agent that explores SPK transport documentation, extracts rules and templates, builds a shipping declaration, validates it locally, and submits it for verification — all in a single run.

## Architecture

```
app.js                          # Entrypoint — session, tracer, MCP, agent loop
├── src/agent.js                # Orchestration loop (LLM ↔ tools, max 60 steps)
├── src/config.js               # Model selection, system instructions, task params
├── src/helpers/
│   ├── api.js                  # LLM chat + vision calls (with tracer injection)
│   ├── logger.js               # Colored console output + verbose/explain mode
│   ├── response.js             # Extract text from Responses API output
│   ├── stats.js                # Token usage accumulator
│   └── shutdown.js             # Graceful SIGINT/SIGTERM handling
├── src/mcp/
│   └── client.js               # MCP stdio client (connects to files-mcp)
├── src/native/
│   └── tools.js                # Custom tools: fetch, vision, knowledge, draft,
│                               # render (with local validation), verify
└── src/services/
    ├── trace-logger.js         # Per-run event recorder (dependency-injected)
    └── session-manager.js      # Session lifecycle (create, update, close)
```

### Key design decisions

| Decision | Rationale |
|---|---|
| **Single-pass agent** | The LLM receives the full pipeline in system instructions and executes all phases autonomously |
| **Tracer as dependency** | Created at startup, passed into every layer (`chat`, `vision`, tool handlers, agent loop). Records all events in-memory, dumps a single JSON trace file at the end — inspired by `01_03_zadanie` |
| **Local validation** (Step 13) | Deterministic regex checks on the declaration before hitting the remote verify endpoint. Catches missing fields, wrong cost, structural issues |
| **MCP for filesystem** | File read/write/manage via a standard MCP server (`files-mcp`), keeping the agent's tool interface uniform |
| **Native tools for domain logic** | `fetch_remote_url`, `analyze_image`, `update_knowledge`, `update_draft`, `render_declaration`, `verify_declaration` are implemented as direct Node.js functions |

## How it works

1. **Session** — A session ID is generated, metadata persisted to `workspace/sessions/`
2. **Tracer** — An event recorder is created for this session and injected everywhere
3. **MCP** — Connects to the `files-mcp` server via stdio for filesystem operations
4. **Agent loop** — Sends the query + tools to the LLM; iterates: LLM responds → tool calls dispatched → results fed back → repeat until text response or max steps
5. **Post-run** — Tracer events are scanned to populate session insights (verify attempts, knowledge updates). Trace file and session file are saved

## Workspace (generated at runtime)

```
workspace/
├── documents/          # Downloaded markdown docs (index.md, zalacznik-*.md, ...)
├── images/             # Downloaded images (analyzed via vision)
├── notes/
│   └── knowledge.json  # Accumulated facts from documentation
├── templates/          # Saved declaration template
├── drafts/
│   ├── declaration-draft.json   # Structured draft fields
│   └── final-declaration.txt    # Rendered declaration text
├── verify-logs/        # Each verify attempt saved as JSON
├── sessions/           # Session metadata (start, end, decisions, attempts)
└── traces/             # Full event trace per run (single JSON file)
```

## Event types in traces

The trace file captures a complete timeline of everything the agent did:

| Event type | Layer | What it records |
|---|---|---|
| `app.start` | app | Session ID, task name, verbose flag |
| `app.mcp_connected` | app | Available MCP and native tools |
| `agent.start` | agent | Query length, tool counts, max steps |
| `agent.step.start` | agent | Step number, message count |
| `agent.step.tools_requested` | agent | Which tools the LLM asked to call |
| `agent.tool.dispatch` | agent | Tool name, arg keys, call ID |
| `agent.tool.result` | agent | Success status, output length |
| `agent.tool.error` | agent | Tool name, error message |
| `agent.finish` | agent | Final step, total messages, response preview |
| `llm.request` | api | Model, input size, tool names |
| `llm.response` | api | Token counts, tool call names, text preview |
| `llm.error` | api | HTTP status, error message |
| `vision.request` | api | Model, question, image size |
| `vision.response` | api | Token counts, answer preview |
| `tool.<name>.start` | tools | Tool-specific input data |
| `tool.<name>.result` | tools | Tool-specific output data |
| `validation.result` | tools | Valid/invalid + list of issues |
| `verify.result` | tools | Success, HTTP status, API response |
| `verify.blocked_by_validation` | tools | Issues that prevented submission |
| `app.finish` | app | Success, total events |
| `app.error` | app | Error message, stack trace |

## Running

```bash
# Install dependencies
npm install

# Run (normal mode — truncated output)
npm start

# Run with verbose/explain mode (full tool args, full outputs, explain messages)
VERBOSE=true npm start

# On Windows PowerShell
$env:VERBOSE="true"; node app.js
```

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `AG3NTS_API_KEY` | Yes | API key for the verification endpoint (set in root `.env`) |
| `AI_PROVIDER` | Yes | AI provider name (set in root `.env`, resolved by `config.js`) |
| `VERBOSE` | No | Set to `true` for full tool output and explain messages |

## Local validation (Step 13)

Before submitting to the verify endpoint, `render_declaration` and `verify_declaration` run deterministic checks:

- Template start/end markers present
- Oath statement present
- All required fields filled (DATA, PUNKT NADAWCZY, NADAWCA, etc.)
- Cost is exactly `0 PP`
- At least 8 separator lines (`------`)

If validation fails, `verify_declaration` refuses to submit and returns the issues list so the agent can self-correct.

## Learning notes

This is a **learning project** — traceability is prioritized over production concerns:

- Every LLM call, tool call, and decision is recorded in the trace
- Session files capture high-level decisions and verify attempts
- Verbose mode shows untruncated data for debugging prompts and tool outputs
- Workspace files persist between runs so you can inspect intermediate state
- The trace JSON file is human-readable (pretty-printed with 2-space indent)
