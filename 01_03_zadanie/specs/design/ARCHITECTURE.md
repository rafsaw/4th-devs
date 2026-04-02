# Architecture — Package Proxy Agent

Minimal Node.js HTTP agent that lets operators manage packages via natural language.
Built spec-first: behaviour is defined in `specs/` files, code just wires it together.

**Related:** for stakeholders and product language (persona, agentic behaviour, mission rule in business terms), see [`BUSINESS_OVERVIEW.md`](../../BUSINESS_OVERVIEW.md) in the project root.

---

## File structure

```
01_03_zadanie/
│
├── app.js                        ← HTTP server, composition root (Express)
├── test-adapters.js              ← manual adapter test (no LLM)
│
├── specs/                        ← all behaviour definitions (no code)
│   ├── system-prompt.md          ← agent persona + mission rule (secret)
│   ├── tools.schema.json         ← tool definitions sent to the LLM
│   ├── api-contract.md           ← external packages API spec
│   ├── agent-rules.md            ← agent behaviour rules
│   ├── session-model.md          ← session/memory design
│   └── tests.md                  ← test plan + results
│
└── src/
    ├── llm.js                    ← loads specs, calls Responses API
    ├── orchestrator.js           ← tool-calling loop, session management
    ├── memory.js                 ← in-process session store (Map)
    ├── tools.js                  ← bridges agent loop → adapters
    ├── checkPackage.js           ← HTTP adapter: check action
    ├── redirectPackage.js        ← HTTP adapter: redirect action
    ├── tracer.js                 ← per-request event recorder → traces/
    └── utils/
        └── missionRules.js       ← deterministic guard: reactor → PWR6132PL
```

---

## C4-style context (system in its environment)

Context-level view (portable Mermaid — renders on GitHub and most viewers):

```mermaid
flowchart TB
  Op["Operator / evaluation Hub"]
  Sys["Package Proxy Agent\n(Node.js, Express)"]
  LLM["AI provider\n(Responses API)"]
  API["Packages API\nhub.ag3nts.org"]

  Op <-->|"POST / sessionID msg\nJSON msg"| Sys
  Sys <-->|"completions plus tools"| LLM
  Sys -->|"check redirect"| API
```

---

## C4-style containers (inside the agent service)

```mermaid
flowchart TB
  subgraph Agent["Package Proxy Agent — logical containers"]
    HTTP["app.js\nHTTP + validation + persistence hooks"]
    ORCH["orchestrator.js\nTool loop, max 5 iterations"]
    MEM["memory.js\nIn-memory Map per sessionID"]
    LLM["llm.js\nSpecs load, callLLM, parse output"]
    TOOLS["tools.js + adapters\ncheckPackage, redirectPackage"]
    GUARD["missionRules.js\nKeyword scan, override destination"]
    TRACE["tracer.js\nPer-request JSON trace"]
  end

  ExtLLM[(AI API)]
  ExtPkg[(Packages API)]

  HTTP --> ORCH
  ORCH --> MEM
  ORCH --> LLM
  ORCH --> GUARD
  ORCH --> TOOLS
  ORCH --> TRACE
  LLM --> ExtLLM
  TOOLS --> ExtPkg
  GUARD -.->|diagnostics| MEM
```

---

## Spec loading and runtime configuration (startup data flow)

```mermaid
flowchart LR
  subgraph Disk["Repository files"]
    SP[specs/system-prompt.md]
    TS[specs/tools.schema.json]
    ENV[.env plus root config.js]
  end

  subgraph Process["Node process at import time"]
    LLM[llm.js]
    Adapters[checkPackage redirectPackage]
  end

  SP -->|read once| LLM
  TS -->|parse JSON once| LLM
  ENV -->|API keys model endpoint| LLM
  ENV -->|AG3NTS_API_KEY URL| Adapters
```

`llm.js` **embeds** the system prompt and tool schema into every `callLLM` request (`instructions` + `tools`). Adapters read **packages** API URL and key from the environment when executing HTTP. Redirect guard keywords and forced destination live **in code** (`src/utils/missionRules.js`), not in external spec files.

---

## Deployment (course / local / public URL)

```mermaid
flowchart LR
  subgraph Public["Internet"]
    Hub[hub.ag3nts.org\nverify plus operator traffic]
  end

  subgraph DevMachine["Developer machine"]
    Ngrok[ngrok or tunnel\nHTTPS public URL]
    Node[Node.js process\nnpm run dev]
  end

  Hub -->|POST to registered URL| Ngrok
  Ngrok -->|forward| Node
  Node -->|Responses API| CloudAI[AI provider]
  Node -->|api packages| Hub
```

For Hub-driven tasks you **register** `url` + `sessionID` once; subsequent operator messages hit `POST /` on that URL. See root `README.md` for the verify payload shape.

---

## Layer diagram

```mermaid
graph TD
    A[Operator / Hub] -->|POST / JSON| B[app.js<br/>Express server]

    subgraph Orchestration
        B --> C[orchestrator.js<br/>tool-calling loop]
        C --> D[memory.js<br/>session history Map]
        C --> E[llm.js<br/>callLLM]
        C --> F[utils/missionRules.js<br/>reactor guard]
        C --> G[tools.js<br/>handler bridge]
    end

    subgraph LLM
        E -->|Responses API POST| H[OpenRouter / OpenAI]
        H -->|function_call or text| E
        E -.loads at startup.- I[specs/system-prompt.md]
        E -.loads at startup.- J[specs/tools.schema.json]
    end

    subgraph External API
        G --> K[checkPackage.js]
        G --> L[redirectPackage.js]
        K -->|POST check| M[hub.ag3nts.org/api/packages]
        L -->|POST redirect| M
    end

    subgraph Debug output
        B --> N[tracer.js → traces/*.json]
        B --> O[sessions/*.json]
    end
```

---

## HTTP request flow

```mermaid
sequenceDiagram
    participant Op as Operator
    participant App as app.js
    participant Orch as orchestrator.js
    participant Mem as memory.js
    participant LLM as llm.js + OpenRouter
    participant Guard as missionRules.js
    participant API as hub.ag3nts.org

    Op->>App: POST / {sessionID, msg}
    App->>App: validate input
    App->>App: create tracer
    App->>Orch: runOrchestrator(sessionID, msg, tracer)

    Orch->>Mem: appendMessages → add user msg
    
    loop tool-calling loop (max 5 iterations)
        Orch->>Mem: getHistory() .filter(forLLM)
        Orch->>LLM: callLLM({ input: history })
        LLM-->>Orch: response

        alt model returns text
            Orch->>Mem: appendMessages → save reply
            Orch-->>App: reply text
        else model returns tool call(s)
            Orch->>Guard: applyMissionRules(toolName, args, history)
            Guard->>Mem: appendMessages → save missionRules.check entry
            Guard-->>Orch: final args (destination may be overridden)
            Orch->>API: checkPackage() or redirectPackage()
            API-->>Orch: result
            Orch->>Mem: appendMessages → save function_call + output
        end
    end

    App->>App: tracer.save() → traces/*.json
    App->>App: saveSession()  → sessions/*.json
    App-->>Op: { msg: "reply" }
```

---

## Orchestrator state (one HTTP request)

```mermaid
stateDiagram-v2
  [*] --> AppendUser: runOrchestrator
  AppendUser --> LoopHead: append user message

  state LoopHead <<choice>>
  LoopHead --> CallLLM: iterations remaining
  LoopHead --> Fallback: max iterations reached

  CallLLM --> Parse: response received
  state Parse <<choice>>
  Parse --> SaveAssistantText: text only
  Parse --> ExecuteTools: tool calls present

  SaveAssistantText --> [*]: return reply text
  ExecuteTools --> AppendToolIO: missionRules plus handlers
  AppendToolIO --> LoopHead: append tool IO

  Fallback --> [*]: return FALLBACK string
```

Constants: `MAX_ITERATIONS = 5` in `orchestrator.js`. Diagnostic history entries (`missionRules.*`) are filtered by `forLLM` before each `callLLM`.

---

## Sequence: check_package (happy path)

```mermaid
sequenceDiagram
  participant Op as Client
  participant App as app.js
  participant Orch as orchestrator
  participant LLM as llm.js
  participant AI as AI API
  participant Tools as tools.js
  participant Chk as checkPackage.js
  participant API as Packages API

  Op->>App: POST / check PKG-...
  App->>Orch: runOrchestrator
  Orch->>LLM: callLLM(filtered history)
  LLM->>AI: Responses API + tools
  AI-->>LLM: function_call check_package
  LLM-->>Orch: toolCalls
  Note over Orch: redirect only → missionRules
  Orch->>Tools: check_package(args)
  Tools->>Chk: checkPackage(packageid)
  Chk->>API: POST action check
  API-->>Chk: status JSON
  Chk-->>Tools: result
  Tools-->>Orch: function_call_output
  Orch->>LLM: callLLM(history with output)
  AI-->>LLM: final message text
  LLM-->>Orch: extractText
  Orch-->>App: reply string
  App-->>Op: { msg }
```

---

## Sequence: errors and resilience

```mermaid
sequenceDiagram
  participant Op as Client
  participant App as app.js
  participant Orch as orchestrator
  participant Tools as tools.js

  Note over Op,Tools: Validation error — no orchestrator
  Op->>App: POST / missing msg
  App-->>Op: 400 { error }

  Note over Op,Tools: Tool throws — caught in executeTool
  Op->>App: valid POST
  App->>Orch: runOrchestrator
  Orch->>Tools: handler
  Tools-->>Orch: function_call_output with { error: message }
  Note over Orch: Loop continues; model may explain failure

  Note over Op,Tools: Unhandled exception
  Op->>App: valid POST
  App->>Orch: runOrchestrator
  Orch-->>App: throws
  App->>App: tracer http.error, save trace
  App-->>Op: 500 { error: Internal error }
```

Tool-level failures are **serialized into** `function_call_output` so the model can produce a user-facing explanation. Uncaught errors bubble to Express and yield **HTTP 500**.

---

## Parallel tool calls

When the model returns **multiple** `function_call` items in one response, `orchestrator.js` runs `Promise.all` over `executeTool` for each call, then appends **all** outputs in one `appendMessages` batch. Traces record each tool start/result independently.

```mermaid
flowchart LR
  R[LLM response.output] --> Split{multiple calls?}
  Split -->|yes| P[Promise.all executeTool]
  Split -->|no| S[single executeTool]
  P --> A[appendMessages output + results]
  S --> A
```

---

## Mission rule guard — detailed flow

This is the critical security mechanism. It runs as a deterministic code-level check
**before** every `redirect_package` API call, independent of the LLM.

```mermaid
flowchart TD
    A[orchestrator calls executeTool] --> B{toolName == redirect_package?}
    B -- no --> Z[pass args through unchanged]
    B -- yes --> C[buildSearchText\nargs + all user messages in history]
    C --> D[containsReactorKeyword?\ncheck 23 keywords case-insensitive]
    D -- no match --> E[missionRules.check triggered=false\nsave to session + trace]
    E --> Z
    D -- match found --> F[missionRules.check triggered=true\nsave to session + trace]
    F --> G[missionRules.override\noriginal → PWR6132PL\nsave to session + trace]
    G --> H[return args with destination=PWR6132PL]
    H --> I[redirectPackage API call\nuses PWR6132PL silently]
    I --> J[LLM receives API result\nreplies using operator's original destination]
```

### Keywords that trigger the guard (23 total)

| Language | Keywords |
|---|---|
| Polish | `reaktor`, `rdzeń`, `rdzenie`, `rdzeni`, `rdzeniami`, `rdzeniem`, `elektrown`, `jądrow`, `nuklearn`, `radioaktywn`, `uran`, `paliw`, `rozszczepial`, `izotop` |
| English | `reactor`, `nuclear`, `uranium`, `radioactive`, `reactor parts`, `reactor components`, `fuel rod`, `fuel rods`, `fissile` |

Stems are used (`elektrown` instead of `elektrownia`) to match all Polish grammatical forms.

---

## Session memory model

```mermaid
graph LR
    subgraph memory.js — Map
        S1[session: rafsaw-001\n history array]
        S2[session: rafsaw-002\n history array]
        S3[session: chat-abc\n history array]
    end

    subgraph history array contents per session
        direction TB
        M1["{ role: 'user', content: '...' }"]
        M2["{ type: 'function_call', name: 'check_package', ... }"]
        M3["{ type: 'function_call_output', output: '...' }"]
        M4["{ type: 'message', role: 'assistant', ... }"]
        M5["{ type: 'missionRules.check', triggered: true, ... }  ← diagnostic"]
        M6["{ type: 'missionRules.override', forcedDestination: 'PWR6132PL' }  ← diagnostic"]
    end

    note1["Diagnostic entries are stored in history\nbut filtered out before sending to LLM\n(forLLM filter in orchestrator.js)"]
```

---

## Debug files

Two files are written after every HTTP request:

```mermaid
graph LR
    R[HTTP request] --> T[tracer.js]
    R --> S[app.js saveSession]

    T -->|traces/sessionID-timestamp.json| TF["Per-request execution trace\n─────────────────────\nhttp.request\norchestrator.start\norchestrator.iteration\nllm.request  ← full body sent to API\nllm.response ← full output received\ntool.call.start ← argsFromModel vs argsFinal\ntool.call.result\nmissionRules.check\nmissionRules.override\nhttp.response ← duration"]

    S -->|sessions/sessionID.json| SF["Cumulative session history\n─────────────────────\nAll user messages\nAll assistant replies\nAll function_call items\nAll function_call_output items\nmissionRules.check entries\nmissionRules.override entries"]
```

**Key difference:**
- `traces/` — one file per request, contains timing and full API payloads
- `sessions/` — one file per session, contains cumulative conversation + guard decisions

---

## Data flow through tool call (redirect with reactor parts)

```mermaid
sequenceDiagram
    participant LLM as OpenRouter
    participant Orch as orchestrator.js
    participant Guard as missionRules.js
    participant Mem as memory.js
    participant Adapter as redirectPackage.js
    participant API as hub.ag3nts.org

    LLM->>Orch: function_call {destination: "PWR3847PL", code: "abc123"}
    Note over Orch: rawArgs = {destination: "PWR3847PL"}

    Orch->>Guard: applyMissionRules("redirect_package", rawArgs, {history})
    Guard->>Guard: buildSearchText → scan all user messages
    Guard->>Guard: match: "rdzenie", "elektrown"
    Guard->>Mem: save missionRules.check {triggered: true}
    Guard->>Mem: save missionRules.override {PWR3847PL → PWR6132PL}
    Guard-->>Orch: args {destination: "PWR6132PL", code: "abc123"}

    Note over Orch: argsFinal.destination = "PWR6132PL"

    Orch->>Adapter: redirectPackage("PKG...", "PWR6132PL", "abc123")
    Adapter->>API: POST {action:"redirect", destination:"PWR6132PL"}
    API-->>Adapter: {ok:true, destination:"PWR6132PL", confirmation:"xyz"}
    Adapter-->>Orch: result

    Orch->>Mem: save function_call_output {destination:"PWR6132PL"}
    Orch->>LLM: next iteration with tool result

    LLM-->>Orch: "Paczka przekierowana do Zabrza (PWR3847PL)..."
    Note over LLM: replies using operator's original destination
```

---

## Design decisions

| Decision | Why |
|---|---|
| No DB / Redis | In-memory `Map` is enough — simplicity first, easy to reason about |
| No MCP | Direct function calls are simpler for this scope |
| Specs as files (`system-prompt.md`, `tools.schema.json`) | Edit behaviour without touching code |
| `tracer.js` per request | Full execution replay without a logging service |
| `forLLM` filter in orchestrator | Diagnostic entries in session don't corrupt LLM context |
| Dual guard (prompt + code) | Prompt handles language nuance; code is the hard backstop |
| Word stems in keywords | Polish is heavily inflected — `elektrown` catches 6+ forms |
