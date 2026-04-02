# Sendit Declaration Agent — Technical Architecture

This document describes the **technical** architecture of the solution in `01_04_zadanie`: runtime topology, components, data flows, sequences, and observability. For domain context, actors, and business rules, see [BUSINESS_OVERVIEW.md](./BUSINESS_OVERVIEW.md). A longer combined narrative also exists in [specs/ARCHITECTURE.md](./specs/ARCHITECTURE.md).

---

## 1. System context

The agent is a **Node.js** process that orchestrates an LLM (OpenAI-compatible Responses API), a **stdio MCP** filesystem server, and **HTTP** calls to public documentation and a verification API.

```mermaid
flowchart TB
    OP[Operator]
    AG[Sendit Agent<br/>Node.js]
    LLM[LLM API<br/>Chat + vision]
    DOC[hub.ag3nts.org<br/>SPK docs + images]
    VER[hub.ag3nts.org/verify]
    MCP[files-mcp<br/>stdio]

    OP -->|runs npm start| AG
    AG --> LLM
    AG --> DOC
    AG --> VER
    AG --> MCP
```

---

## 2. Container / deployment view

At runtime, **two OS processes** cooperate: the main agent and the MCP server child process.

```mermaid
flowchart TB
    subgraph Host["Developer machine / CI runner"]
        subgraph P1["Process: node app.js"]
            APP[app.js]
            AGENT[agent.js]
            API[helpers/api.js]
            TOOLS[native/tools.js]
            TRACER[trace-logger.js]
            SESS[session-manager.js]
        end
        subgraph P2["Child process: npx tsx ../mcp/files-mcp"]
            MCP[files-mcp]
        end
    end

    P1 <-->|stdio JSON-RPC| P2
    P1 -->|HTTPS| LLM[Responses API]
    P1 -->|HTTPS| DOCS[hub.ag3nts.org/dane/doc/]
    P1 -->|HTTPS POST| VERIFY[hub.ag3nts.org/verify]
    MCP -->|read/write under FS_ROOT| WS[(workspace/)]
    TOOLS -->|direct fs| WS
```

| Integration | Protocol | Config |
|-------------|----------|--------|
| LLM chat + vision | HTTPS + JSON | Root `config.js` — `AI_API_KEY`, `RESPONSES_API_ENDPOINT` |
| MCP filesystem | stdio (MCP SDK) | `mcp.json` — spawns `npx tsx ../mcp/files-mcp/...`, `FS_ROOT: "."` |
| Remote docs | HTTPS GET | `src/config.js` — `docs.indexUrl`, `docs.baseUrl` |
| Verification | HTTPS POST JSON | `src/config.js` — `verify.endpoint`, env `AG3NTS_API_KEY` |

---

## 3. Logical component diagram

```mermaid
flowchart TB
    subgraph Entry
        APP[app.js]
    end
    subgraph Orchestration
        RUN[agent.run]
    end
    subgraph LLM
        CHAT[api.chat]
        VISION[api.vision]
        RESP[response.js]
    end
    subgraph Tools
        DISPATCH{isNativeTool?}
        NAT[nativeHandlers in tools.js]
        MCP_CALL[mcp/callMcpTool]
    end
    subgraph Services
        TR[createTracer]
        SM[session-manager]
    end
    subgraph Config
        CFG[config.js]
    end

    APP --> SM
    APP --> TR
    APP --> RUN
    RUN --> CFG
    RUN --> CHAT
    CHAT --> RESP
    NAT --> VISION
    RUN --> DISPATCH
    DISPATCH -->|yes| NAT
    DISPATCH -->|no| MCP_CALL
    CHAT -.->|tracer| TR
    NAT -.->|tracer| TR
    RUN -.->|tracer| TR
```

---

## 4. Module map (source tree)

```mermaid
flowchart LR
    APP[app.js] --> AG[agent.js]
    AG --> API[helpers/api.js]
    AG --> MC[mcp/client.js]
    AG --> NT[native/tools.js]
    APP --> SM[services/session-manager.js]
    APP --> TL[services/trace-logger.js]
    NT --> API
    API --> CFG_ROOT[../../config.js]
    AG --> CFG[src/config.js]
```

| Path | Role |
|------|------|
| `app.js` | Session + tracer lifecycle, MCP connect, `run()`, insight extraction, trace save |
| `src/agent.js` | Tool-augmented loop (max 60 steps), parallel tool execution |
| `src/config.js` | Model, system **instructions** (pipeline), `task`, `docs`, `verify` |
| `src/helpers/api.js` | `chat`, `vision`, `extractToolCalls`, `extractText` |
| `src/native/tools.js` | Six native tools + `validateDeclaration` |
| `src/mcp/client.js` | Spawn MCP, `listTools`, `callMcpTool`, schema → OpenAI tool format |
| `src/services/trace-logger.js` | In-memory events → `workspace/traces/*.json` |
| `src/services/session-manager.js` | `workspace/sessions/*.json` |

---

## 5. Agent control loop (sequence)

The loop is **stateless in code** beyond the `messages[]` array: the model decides the next action from system instructions + history.

```mermaid
sequenceDiagram
    participant App as app.js
    participant Agent as agent.js
    participant LLM as Responses API
    participant MCP as MCP tools
    participant Nat as Native tools
    participant T as tracer

    App->>Agent: run(query, { mcpClient, mcpTools, tracer })
    Agent->>T: agent.start

    loop step 1..MAX_STEPS (60)
        Agent->>T: agent.step.start
        Agent->>LLM: chat(input=messages, tools, instructions, tracer)
        LLM-->>Agent: output[] (function_call and/or message)

        alt No function_call items
            Agent->>T: agent.finish
            Agent-->>App: { response: text }
        else One or more function_call
            Agent->>T: agent.step.tools_requested
            Agent->>Agent: messages.push(...output)
            par Parallel Promise.all
                Agent->>Nat: executeNativeTool (if native)
                Agent->>MCP: callMcpTool (if MCP)
            end
            Agent->>Agent: messages.push(...function_call_output)
        end
    end

    Note over Agent: If max steps: agent.max_steps_reached, throw
```

---

## 6. Tool routing and hybrid architecture

All tools are exposed to the model as a single flat `tools` array: MCP tools (from `listTools`) plus `nativeTools` definitions from `tools.js`.

```mermaid
flowchart LR
    subgraph OpenAI_tools_array
        T1[fs_read / fs_write / ...]
        T2[fetch_remote_url]
        T3[analyze_image]
        T4[update_knowledge]
        T5[update_draft]
        T6[render_declaration]
        T7[verify_declaration]
    end
    LLM[Model] --> T1 & T2 & T3 & T4 & T5 & T6 & T7
    T1 --> MCP[stdio → files-mcp]
    T2 & T3 & T4 & T5 & T6 & T7 --> JS[In-process Node handlers]
```

```mermaid
sequenceDiagram
    participant A as agent.runTool
    participant N as isNativeTool
    participant H as nativeHandlers
    participant C as callMcpTool

    A->>N: tool name
    alt native
        N-->>A: true
        A->>H: executeNativeTool(name, args, tracer)
        H-->>A: JSON-serializable result
    else MCP
        N-->>A: false
        A->>C: client.callTool
        C-->>A: parsed JSON or text
    end
    A->>A: function_call_output JSON.stringify(result)
```

---

## 7. Data flow: documentation → verified declaration

```mermaid
flowchart TD
    subgraph External
        IDX[index.md + attachments]
        IMG[Route map image]
    end
    subgraph Transient_context["LLM context (messages[])"]
        TXT[Full text of fetched .md in tool outputs]
        VIS[Vision answer strings]
    end
    subgraph Workspace_persisted["workspace/ (disk)"]
        DOC[documents/*.md]
        IMGF[images/*]
        K[notes/knowledge.json]
        D[drafts/declaration-draft.json]
        F[drafts/final-declaration.txt]
        V[verify-logs/*.json]
    end

    IDX -->|fetch_remote_url| TXT
    IDX --> DOC
    IMG -->|fetch saves binary| IMGF
    IMGF -->|analyze_image| VIS
    TXT --> K
    VIS --> K
    TXT --> D
    K --> D
    D -->|render_declaration| F
    F -->|validateDeclaration| OK{valid?}
    OK -->|yes| VERIFY[verify_declaration POST]
    OK -->|no| D
    VERIFY --> V
```

---

## 8. Declaration pipeline: render vs verify (validation gate)

Local validation runs in **`validateDeclaration`** inside `tools.js` before any network verify call. `render_declaration` always validates and still writes `final-declaration.txt`; `verify_declaration` **blocks** the HTTP POST if validation fails.

```mermaid
flowchart TD
    R[render_declaration] --> V1[validateDeclaration]
    V1 --> M1{valid?}
    M1 -->|no| U1[Update draft status validation_failed, return issues]
    M1 -->|yes| S1[Write final-declaration.txt, draft rendered]

    Q[verify_declaration] --> V2[validateDeclaration]
    V2 --> M2{valid?}
    M2 -->|no| B[verify.blocked_by_validation — no HTTP]
    M2 -->|yes| POST[POST verify.endpoint with task + answer.declaration]
    POST --> LOG[Write verify-logs/verify-*.json]
    LOG --> TRC[tracer verify.result]
```

**Deterministic checks** (summary):

- Header marker: `SYSTEM PRZESYŁEK KONDUKTORSKICH - DEKLARACJA ZAWARTOŚCI`
- Footer line: closing `======================================================`
- Oath line present
- Ten labeled fields match regexes (including `KATEGORIA PRZESYŁKI: [A-E]`, `KWOTA DO ZAPŁATY`)
- `KWOTA DO ZAPŁATY` value must be exactly `0 PP` (trimmed)
- At least eight separator lines matching `^-{40,}$` per line

---

## 9. Verification API interaction (sequence)

```mermaid
sequenceDiagram
    participant LLM as Model
    participant Tool as verify_declaration
    participant Val as validateDeclaration
    participant API as hub.ag3nts.org/verify
    participant Disk as workspace/verify-logs

    LLM->>Tool: declaration string
    Tool->>Val: validateDeclaration(declaration)
    alt invalid
        Val-->>Tool: issues[]
        Tool-->>LLM: success false, blocked true, issues
    else valid
        Val-->>Tool: valid
        Tool->>API: POST { apikey, task: sendit, answer: { declaration } }
        API-->>Tool: JSON body
        Tool->>Disk: verify-{timestamp}.json
        Tool-->>LLM: success, data, logFile
    end
```

**Success heuristic** (implementation): `data.code === 0` **or** `message` contains `flag` / `FLG` (case-sensitive substring checks).

---

## 10. Observability: tracer injection

The tracer is created once per run and passed into `chat`, `vision`, and native tool handlers. `app.js` post-processes events into session fields.

```mermaid
flowchart TB
    CREATE[createTracer sessionId] --> MEM[(events array)]
    MEM --> APP[app.js records app.*]
    MEM --> AG[agent records agent.*]
    MEM --> LLM[api records llm.* / vision.*]
    MEM --> TL[tools record tool.* / validation.* / verify.*]
    MEM --> SAVE[tracer.save → workspace/traces/]
    MEM --> SCAN[extractSessionInsights]
    SCAN --> SESS[updateSession: verifyAttempts, validations, importantDecisions]
```

Representative **event families**:

| Prefix | Examples |
|--------|----------|
| `app.*` | `app.start`, `app.mcp_connected`, `app.finish`, `app.error` |
| `agent.*` | `agent.start`, `agent.step.start`, `agent.tool.dispatch`, `agent.finish` |
| `llm.*` / `vision.*` | Request/response/error metadata |
| `tool.<name>.*` | Per-tool start/result |
| `validation.result` | Local gate outcome |
| `verify.*` | Remote outcome or blocked-by-validation |

Optional **tool name catalog**: after MCP connects, `tracer.setToolNames([...])` can compact tool references in saved JSON.

---

## 11. Session file lifecycle

```mermaid
stateDiagram-v2
    [*] --> running: createSession writes sessions/id.json
    running --> running: updateSession merges insights
    running --> completed: closeSession success
    running --> failed: closeSession on error
    completed --> [*]
    failed --> [*]
```

---

## 12. Configuration and secrets

| Variable / file | Used by |
|-----------------|---------|
| Root `.env` + `AI_API_KEY` | `helpers/api.js` → LLM |
| `AG3NTS_API_KEY` | `verify_declaration` payload |
| `AI_PROVIDER` / root `config.js` | Resolves `api.model` via `resolveModelForProvider` |
| `VERBOSE` | `logger.js` verbosity |
| `mcp.json` | MCP command, args, `FS_ROOT` |

---

## 13. Failure modes

| Failure | Behavior |
|---------|----------|
| LLM HTTP error | `llm.error` trace, exception propagates; `app.error`, session closed failed, trace saved |
| MCP spawn failure | Exception before agent loop |
| Tool throws | `function_call_output` contains `{ error: message }`, `agent.tool.error` |
| Max 60 steps | `agent.max_steps_reached`, process error |
| Missing `AG3NTS_API_KEY` | Verify POST still attempted with empty key; server likely rejects (warning at startup) |

---

## 14. Related documents

- [BUSINESS_OVERVIEW.md](./BUSINESS_OVERVIEW.md) — domain, shipment, business process, glossary  
- [README.md](./README.md) — how to run and workspace layout  
- [specs/ARCHITECTURE.md](./specs/ARCHITECTURE.md) — extended narrative + example timelines  
