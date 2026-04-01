# 01_05_zadanie — Railway agent (extension of 01_04_zadanie)

This folder is **not a new architecture**. It implements the AG3NTS **`railway`** task using the **same patterns as `01_04_zadanie`**: `app.js` entrypoint, `src/agent.js` loop, MCP + native tools, **dependency-injected tracer**, **session JSON** under `workspace/sessions/`, and Responses API chat in `src/helpers/api.js`.

What differs is **task config**, **native tools** (railway verify + state + log inspection), and a **resilience layer** for the unstable verify HTTP API (`src/helpers/railway-http.js`).

---

## Purpose

- Solve the **`railway`** verify task: discover the API via **`help`**, drive the correct action sequence (including activating route **X-01**), and obtain **`{FLG:...}`**.
- Operate against an **undocumented, rate-limited** endpoint that may return **503** and signals like **`Retry-After`**.
- Use an **agent with native tools**: the model proposes tool calls; tools perform real HTTP and persistence; **retries and waits** are implemented in code, not left to the model.

---

## Relationship to 01_04_zadanie

| Aspect | 01_04_zadanie | 01_05_zadanie (this folder) |
|--------|----------------|-------------------------------|
| Entry + lifecycle | `app.js`, session, tracer | **Same structure** |
| Orchestration | `src/agent.js` (`run`, max steps) | **Same file pattern** |
| LLM I/O | `src/helpers/api.js` + root `config.js` | **Same** |
| Tracer | `src/services/trace-logger.js` | **Same pattern** (`createTracer`, `record`, `save`) |
| Sessions | `src/services/session-manager.js` | **Adapted** IDs/objective (`railway-session-*`) |
| Native tools | `src/native/tools.js` (sendit) | **Replaced** with `railway_*` tools |
| Verify HTTP | Simple `fetch` in tool | **Extended** with `railway-http.js` (backoff, headers) |
| MCP | `mcp.json` → files-mcp | **Same** |

---

## How to run

### Setup

```bash
cd 01_05_zadanie
npm install
```

### Environment (repository root `.env`)

The repo root `config.js` loads **`c:\Users\rafal\repos\4th-devs\.env`** (or your checkout’s root `.env`). You need:

| Variable | Role |
|----------|------|
| `AG3NTS_API_KEY` | Verify API key for `POST https://hub.ag3nts.org/verify` |
| `OPENAI_API_KEY` or `OPENROUTER_API_KEY` | One must be set per root `config.js` |
| `AI_PROVIDER` | Optional: `openai` or `openrouter` |

Optional:

| Variable | Role |
|----------|------|
| `VERBOSE` | Set to `true` for full tool args/output in the console |

### Start

```bash
npm start
```

PowerShell verbose:

```powershell
$env:VERBOSE="true"; node app.js
```

---

## Where to observe execution

| Output | Purpose |
|--------|---------|
| `workspace/traces/*.json` | Full timeline: `llm.*`, `agent.*`, `tool.*`, `railway.http.*`, `verify.result` |
| `workspace/sessions/*.json` | Session metadata + post-run summaries (`verifyAttempts`, `httpRetries`, etc.) |
| `workspace/railway-logs/*.json` | One file per **completed** `postRailwayVerify` chain: request `answer`, final `outcome`, selected headers |
| `workspace/notes/railway-state.json` | Facts merged by `railway_update_state` (optional) |

Use **`railway_list_recent_calls`** in a run to let the model summarize recent logs; use the files directly for debugging.

---

## S01E05-style concepts in this codebase

- **Retry + backoff for 503 (and similar):** `src/helpers/railway-http.js` retries **502 / 503 / 429 / 408** and network failures with exponential backoff + jitter, capped per wait.
- **Rate-limit awareness:** waits prefer **`Retry-After`**, then **`X-RateLimit-Reset` / `RateLimit-Reset`** when present; otherwise falls back to backoff.
- **Spec-driven flow:** first tool call must use **`answer` with `"action": "help"`** (see `app.js` query and `src/config.js` instructions). No hardcoded action graph beyond that.
- **Bounded agent:** `src/agent.js` — max **60** LLM steps; HTTP layer has its own **max attempts** per `railway_api_call`.
- **Tracing / observability:** same tracer injection style as `01_04_zadanie`; extra event families for HTTP retries (`railway.http.*`).
- **Minimizing wasted verify calls:** duplicate identical `answer` JSON **without a flag** is blocked after **5** consecutive tries; instructions tell the model not to spam.

---

## MODEL CHOICE FOR THIS TASK

### How the model is selected (verified in code)

1. **`01_05_zadanie/src/config.js`** exports `api.model` and `api.visionModel` as:
   - `resolveModelForProvider("openai/gpt-5-nano")`
2. **`resolveModelForProvider`** lives in the **repository root** `config.js`. It only adjusts the string when `AI_PROVIDER === "openrouter"` and the model id has no `/` (prefixes with `openai/`). Otherwise the id is passed through unchanged.
3. **`src/helpers/api.js`** uses `api.model` (and `api.visionModel` for vision) as the default for `chat()` / `vision()`.

So today the model is:

- **Effectively hardcoded** in the lesson’s `src/config.js` (not read from `process.env` in this package).
- **Inherited from the same pattern as `01_04_zadanie`**, which uses the **same** `openai/gpt-5-nano` lines.
- **Changeable** by editing `src/config.js` (or by extending that file to read an env var—**not** implemented today).

### What is used right now

**`openai/gpt-5-nano`** for both chat and vision slots (vision is unused in the railway toolset but kept for parity with the lesson layout).

### Is that a good fit?

**Partially.**

**Pros of a smaller model**

- Lower **LLM** token cost per step.
- Often lower latency per step.

**Cons for this task (important)**

- The **`railway`** task punishes **wrong tool arguments** and **extra verify calls** more than it punishes LLM spend. Each mistaken `answer` shape can burn **quota**, trigger **429**, or force long **503** backoff loops.
- **Undocumented API + help text** needs careful reading; smaller models are more prone to **skipping** `help` discipline, **hallucinating** action names not present in the spec, or **repeating** bad payloads until the duplicate guard fires.
- **Instruction-following** and **structured tool use** matter more than raw speed.

So **`gpt-5-nano` is acceptable for experiments** but **not the best default** if your priority is **fewest verify round-trips** and **fewest agent repair loops**.

### Recommended default (architecture-oriented)

Use a **more capable model in the same `api.model` slot**—still on your existing **Responses API** path and **`resolveModelForProvider`**—so you do not change the rest of the stack.

Practical guidance:

1. Prefer a **mid-tier or stronger** model your provider actually exposes on the Responses API (exact id depends on `AI_PROVIDER` and account).
2. In **`01_04_zadanie`**, `src/config.js` still contains a commented alternative (`//gpt-4.1`), which reflects the same lesson pattern: **swap the model string in `src/config.js`** when you need better tool reliability.
3. For **`railway`**, bias toward **reasoning + tool-use quality** over **nano-tier** cost savings, because **verify API errors are the dominant operational risk**.

**Concrete starting point:** change `openai/gpt-5-nano` to whatever your provider lists as the **next tier up** (for example a **`mini`** or small **`gpt-4.x`** class model **if available** on your endpoint). Verify the id against your provider’s Responses API model list—do not assume every id works on both OpenAI and OpenRouter.

---

## Further reading

- **`ARCHITECTURE.md`** — extension of `01_04_zadanie`, layers, flow, model rationale, tracer/debug.
- **`ARCHITECTURE_AND_BUSINESS.md`** — business context, requirements mapping, Mermaid diagrams, HTTP header behavior in detail.
