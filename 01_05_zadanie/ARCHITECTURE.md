# Architecture — 01_05_zadanie (railway)

This document describes **01_05_zadanie** as an **extension** of **`01_04_zadanie`**, not a separate system. File names and responsibilities follow the same lesson layout (`app.js`, `src/agent.js`, `src/native/tools.js`, `src/services/*`, `src/helpers/api.js`).

For diagrams and a detailed HTTP / header matrix, see **`ARCHITECTURE_AND_BUSINESS.md`**.

---

## 1. Extension vs 01_04_zadanie

**Unchanged pattern**

- **App shell:** create session → create tracer → connect MCP → `run()` agent → enrich session from tracer → save trace.
- **Agent loop:** `src/agent.js` — Responses API `chat`, tool dispatch, `MAX_STEPS = 60`, tracer on every step.
- **Tracer:** `src/services/trace-logger.js` — same `createTracer` / `record` / `save` / optional `setToolNames`.
- **Session store:** `src/services/session-manager.js` — same create/update/close pattern; railway-specific session id prefix and metadata only.
- **LLM client:** `src/helpers/api.js` — same request shape; reads **`api.model`** from **`src/config.js`**.
- **MCP:** `src/mcp/client.js` + `mcp.json` — same stdio files server hookup.

**New or adapted for railway**

| Piece | Role |
|-------|------|
| `src/config.js` | Task `railway`, verify endpoint/key, **system instructions** (spec-driven, help-first). |
| `src/native/tools.js` | **Native tools:** `railway_api_call`, `railway_update_state`, `railway_list_recent_calls`; duplicate-payload guard. |
| `src/helpers/railway-http.js` | **Reliability layer:** retries, `Retry-After` / reset headers, backoff, **per-invocation log file**, `verify.result` + `railway.http.*` tracer events. |
| `app.js` | Railway **user query**; **`extractSessionInsights`** adds `httpRetries` slice and railway state updates. |

**Intentionally not recreated**

- Sendit-specific tools (fetch docs, declaration validation, `verify_declaration` payload shape) — replaced by railway tools only.

---

## 2. Main layers

### 2.1 Agent reasoning layer

- **Component:** `src/agent.js` + LLM in `src/helpers/api.js`.
- **Responsibility:** Choose **which tool** to call and with **which arguments**, using conversation history + tool outputs.
- **Constraints:** Bounded by **max steps**, tool schemas, and system **instructions** in `src/config.js` (must start from **help**, avoid guessed actions).

### 2.2 Native tool layer

- **Component:** `src/native/tools.js`.
- **Responsibility:** Execute **domain actions**: POST verify (`railway_api_call`), persist notes (`railway_update_state`), read recent logs (`railway_list_recent_calls`).
- **Contract:** Return **structured JSON** for the model; record **`tool.*`** tracer events.

### 2.3 Reliability / control layer

- **Component:** `src/helpers/railway-http.js` (used only from `railway_api_call`).
- **Responsibility:** **How** HTTP is executed safely: timeout per attempt, **retry** transient statuses, **sleep** using headers or backoff, write **`workspace/railway-logs/*.json`**.
- **Separation:** The model does not implement retries; **code** does, so behavior is consistent and observable (`railway.http.attempt`, `railway.http.backoff`, etc.).

### 2.4 Tracing and session logs

- **Tracer:** `workspace/traces/<sessionId>--<timestamp>.json` — full event stream (LLM, agent, tools, HTTP).
- **Session:** `workspace/sessions/<sessionId>.json` — human-oriented summary; **updated after** the run with verify summaries and recent HTTP-related events (`app.js`).
- **Per-call HTTP artifact:** `workspace/railway-logs/*.json` — request/answer + final outcome for that `postRailwayVerify` invocation.

### 2.5 Config / model selection layer

- **Component:** `src/config.js` (lesson) + root `config.js` (provider, keys, `resolveModelForProvider`).
- **Responsibility:** **`api.model`** passed into `chat()`; **`api.instructions`** (system) define spec-driven behavior; **`verify`** holds endpoint + API key env.

---

## 3. MODEL SELECTION RATIONALE

### Where it sits

Model choice is **centralized** in **`01_05_zadanie/src/config.js`**:

```js
model: resolveModelForProvider("openai/gpt-5-nano"),
```

The **Responses API** request is built in **`src/helpers/api.js`** using that default. There is **no** separate “agent definition” file for model id in this lesson.

### Why it matters for railway

Failures here are rarely “wrong prose”; they are **wrong tool JSON** and **wrong sequencing**:

- Extra or malformed **`railway_api_call`** → wasted **verify** quota, **429**, long **503** waits.
- Misreading **help** → hallucinated **action** names or parameters.

So model choice is a **reliability knob** for the **verify API**, not only an LLM cost knob.

### Failure modes of a weaker / smaller default

With a **nano-tier** default (current: **`openai/gpt-5-nano`**):

- More **repair loops** inside the 60-step bound.
- Higher chance of **repeated bad** `answer` payloads until the **duplicate guard** blocks (operationally noisy).
- More pressure on **`railway_list_recent_calls`** / **`railway_update_state`** to recover—works, but is slower.

### Recommended balance (same architecture)

Keep **one** model string in **`src/config.js`** (same pattern as **`01_04_zadanie`**), but prefer a **stronger** model your **`AI_PROVIDER`** actually supports on the **Responses** endpoint, because:

- You already pay for **robust HTTP** and **tracing**; pairing that with the weakest model underuses the stack.
- The **dominant risk** is **verify** instability and **rate limits**, not LLM bill alone.

**Implementation note:** today the model is **not** env-driven in this folder; swapping default means **editing `src/config.js`** (or adding an env read there if you standardize that across lessons).

---

## 4. End-to-end flow (step by step)

1. **User / operator** runs `node app.js` (or `npm start`) from **`01_05_zadanie`**.
2. **`app.js`** creates **session** + **tracer**, connects **MCP**, registers tool name catalog on tracer.
3. **`run(AGENT_QUERY)`** in **`src/agent.js`** sends the **initial user message** + tools to the **LLM** (`chat` with `api.model` + `api.instructions`).
4. **LLM** returns **tool calls** or **final text**.
5. For each tool call:
   - **`railway_api_call`**: builds verify payload → **`postRailwayVerify`** → **verify API** → optional retries/waits → **log file** + **tracer** events → JSON back to model.
   - **Other tools**: read/write local state or logs as implemented.
6. Loop continues until **no tool calls** (final assistant text) or **max steps**.
7. **`app.js`** merges tracer insights into **session**, marks session closed, **`tracer.save()`**.

**Completion:** Business success is **`{FLG:...}`** in API or tool output; the model is instructed to **stop** and report the flag. Technical persistence of outcomes is in **railway-logs** + **verify.result** tracer events.

---

## 5. Debugging failed or repeated calls

1. Open the latest **`workspace/traces/*.json`** for the session id printed at startup.
2. Search for:
   - **`railway.http.response_error`** — status, `shouldRetry`, `headerWaitMs`, body preview.
   - **`railway.http.backoff`** — actual **waitMs** applied.
   - **`verify.result`** — normalized outcome linkage to **`logFile`**.
3. Open the referenced **`workspace/railway-logs/<file>.json`** for full **request `answer`** and **final `outcome`** (including subset of **headers**).
4. Open **`workspace/sessions/<sessionId>.json`** for **`verifyAttempts`** and the recent **`httpRetries`** slice written by **`app.js`**.

This matches how **`01_04_zadanie`** expects you to debug: **trace first**, then **domain logs** (there: verify-logs; here: railway-logs).
