# Sendit Declaration Agent — Architecture & Business Process

## 1. Business Context

The **Sendit** exercise simulates a post-apocalyptic transport system called **SPK** (System Przesyłek Konduktorskich — Conductor Parcel System). Your goal: build a valid shipping declaration for a specific cargo, submit it to a remote verification endpoint, and receive a flag.

The catch: *you* don't build the declaration. An **autonomous LLM agent** does — by exploring remote documentation, extracting rules, filling a template, and iterating on verification feedback.

### 1.1 The Shipment

| Field | Value |
|---|---|
| Sender ID | `450202122` |
| Origin | Gdańsk |
| Destination | Żarnowiec |
| Weight | 2800 kg |
| Cargo | Kasety z paliwem do reaktora |
| Budget | 0 PP (must be free/system-funded) |

### 1.2 The Challenge

The agent must autonomously:
1. Discover and read all relevant SPK documentation (markdown, images)
2. Extract the declaration template, route codes, fee rules, category exemptions
3. Construct a valid declaration matching the exact template format
4. Pass local validation checks
5. Submit to the verification API and handle success/failure

---

## 2. High-Level Architecture

```mermaid
graph TB
    subgraph "Entrypoint"
        APP[app.js]
    end

    subgraph "Orchestration"
        AGENT[agent.js<br/>Loop: LLM ↔ Tools<br/>Max 60 steps]
    end

    subgraph "LLM Layer"
        CHAT[api.js — chat<br/>Responses API]
        VISION[api.js — vision<br/>Image analysis]
    end

    subgraph "Tool Layer"
        MCP[MCP Client<br/>fs_read, fs_write<br/>fs_search, fs_manage]
        NATIVE[Native Tools<br/>fetch_remote_url<br/>analyze_image<br/>update_knowledge<br/>update_draft<br/>render_declaration<br/>verify_declaration]
    end

    subgraph "Services"
        TRACER[trace-logger.js<br/>Event recorder]
        SESSION[session-manager.js<br/>Session lifecycle]
    end

    subgraph "External"
        DOCS_SERVER[hub.ag3nts.org<br/>SPK Documentation]
        VERIFY_API[hub.ag3nts.org/verify<br/>Declaration checker]
    end

    subgraph "Workspace — generated at runtime"
        WS_DOCS[documents/]
        WS_IMG[images/]
        WS_NOTES[notes/knowledge.json]
        WS_TEMPLATES[templates/]
        WS_DRAFTS[drafts/]
        WS_VERIFY[verify-logs/]
        WS_TRACES[traces/]
        WS_SESSIONS[sessions/]
    end

    APP --> SESSION
    APP --> TRACER
    APP --> AGENT
    AGENT --> CHAT
    AGENT --> NATIVE
    AGENT --> MCP
    NATIVE --> VISION
    NATIVE --> DOCS_SERVER
    NATIVE --> VERIFY_API
    MCP --> WS_DOCS
    MCP --> WS_TEMPLATES
    NATIVE --> WS_DOCS
    NATIVE --> WS_IMG
    NATIVE --> WS_NOTES
    NATIVE --> WS_DRAFTS
    NATIVE --> WS_VERIFY
    TRACER --> WS_TRACES
    SESSION --> WS_SESSIONS
```

---

## 3. Component Responsibilities

```mermaid
graph LR
    subgraph "app.js — Entrypoint"
        A1[Create session]
        A2[Create tracer]
        A3[Connect MCP]
        A4[Run agent]
        A5[Extract insights from tracer events]
        A6[Save trace + session]
    end
    A1 --> A2 --> A3 --> A4 --> A5 --> A6
```

| Component | File | Responsibility |
|---|---|---|
| **Entrypoint** | `app.js` | Creates session, tracer, MCP connection; runs agent; post-processes tracer events into session insights; saves everything |
| **Agent** | `src/agent.js` | Orchestration loop: sends messages+tools to LLM, dispatches tool calls, feeds results back. Stops when LLM returns text (no tool calls) or hits 60 steps |
| **LLM API** | `src/helpers/api.js` | `chat()` — Responses API calls; `vision()` — image analysis. Both accept optional `tracer` for recording request/response events |
| **Native Tools** | `src/native/tools.js` | Domain-specific tools: HTTP fetching, image analysis, knowledge/draft persistence, declaration rendering (with validation), verification submission |
| **MCP Client** | `src/mcp/client.js` | Connects to `files-mcp` server via stdio; provides `fs_read`, `fs_write`, `fs_search`, `fs_manage` |
| **Tracer** | `src/services/trace-logger.js` | In-memory event array; passed as dependency to every layer; dumps single JSON file at end |
| **Session** | `src/services/session-manager.js` | Creates/updates/closes session metadata JSON |
| **Config** | `src/config.js` | Model selection, system instructions (the "brain" of the agent), task parameters, endpoint URLs |
| **Logger** | `src/helpers/logger.js` | Colored console output with optional verbose/explain mode (`VERBOSE=true`) |

---

## 4. The Agent Loop — How Decisions Are Made

### 4.1 Overview — The Full Loop

```mermaid
sequenceDiagram
    participant App as app.js
    participant Agent as agent.js
    participant LLM as GPT-5 Nano
    participant Tools as Tool Layer
    participant Tracer as Tracer

    App->>Agent: run(query, {mcpClient, mcpTools, tracer})
    Agent->>Tracer: record("agent.start")

    loop Step 1..N (max 60)
        Agent->>Tracer: record("agent.step.start", {step})
        Agent->>LLM: chat({messages, tools, tracer})
        LLM-->>Agent: response (tool_calls[] or text)

        alt LLM returns text (no tool calls)
            Agent->>Tracer: record("agent.finish")
            Agent-->>App: {response: text}
        else LLM returns tool calls
            Agent->>Tracer: record("agent.step.tools_requested")
            loop Each tool call (parallel)
                Agent->>Tools: dispatch(toolName, args, tracer)
                Tools->>Tracer: record("tool.X.start")
                Tools-->>Agent: result
                Agent->>Tracer: record("agent.tool.result")
            end
            Note over Agent: Append tool results to messages
            Note over Agent: Continue to next step
        end
    end
```

### 4.2 Path A — Tool Calls (steps 1–10 in a typical run)

When the LLM still has work to do, it returns one or more `function_call` items instead of text. The agent dispatches them all in parallel, collects results, and feeds them back as the next conversation turn.

```mermaid
sequenceDiagram
    participant Agent as agent.js
    participant LLM as GPT-5 Nano
    participant T1 as Tool 1
    participant T2 as Tool 2
    participant TN as Tool N
    participant Tracer as Tracer

    Agent->>LLM: chat({messages, tools})
    Note over LLM: LLM analyzes conversation history<br/>+ system instructions → decides<br/>which tools to call and with what args

    LLM-->>Agent: response.output = [<br/>  function_call("fetch_remote_url", {url: "..."}),<br/>  function_call("fetch_remote_url", {url: "..."}),<br/>  function_call("analyze_image", {image_path: "..."})<br/>]

    Agent->>Tracer: record("agent.step.tools_requested",<br/>{toolNames: [...]})

    Note over Agent: Append LLM output items to messages[]

    par Parallel execution (Promise.all)
        Agent->>T1: execute("fetch_remote_url", args, tracer)
        T1->>Tracer: record("tool.fetch_remote_url.start")
        T1-->>Agent: {type:"text", content:"...", length:42626}
        Agent->>Tracer: record("agent.tool.result", {success:true})
    and
        Agent->>T2: execute("fetch_remote_url", args, tracer)
        T2->>Tracer: record("tool.fetch_remote_url.start")
        T2-->>Agent: {type:"text", content:"...", length:1070}
        Agent->>Tracer: record("agent.tool.result", {success:true})
    and
        Agent->>TN: execute("analyze_image", args, tracer)
        TN->>Tracer: record("tool.analyze_image.start")
        TN-->>Agent: {answer:"Route X-01...", image_path:"..."}
        Agent->>Tracer: record("agent.tool.result", {success:true})
    end

    Note over Agent: Append all function_call_output items<br/>to messages[] → loop back to LLM
```

**What happens in the messages array:**

```
messages = [
  {role: "user",                content: "Your objective: Build a valid SPK..."},   // initial query
  {type: "function_call",       name: "fetch_remote_url", arguments: "..."},        // LLM's choice
  {type: "function_call_output", call_id: "...", output: "{content: '...'}"},       // tool result
  {type: "function_call",       name: "update_knowledge", arguments: "..."},        // LLM's next choice
  {type: "function_call_output", call_id: "...", output: "{status: 'updated'}"},    // tool result
  ...                                                                                // grows each step
]
```

The conversation history **is** the agent's memory. Each step the LLM sees everything that happened before and decides the next action.

### 4.3 Path B — Text Response (final step)

When the LLM determines all work is done (verification succeeded, or it has nothing more to do), it returns a text message instead of tool calls. This terminates the loop.

```mermaid
sequenceDiagram
    participant Agent as agent.js
    participant LLM as GPT-5 Nano
    participant Tracer as Tracer
    participant App as app.js

    Note over Agent: Step 11 — messages[] contains<br/>48 items (all prior tool calls + results)

    Agent->>LLM: chat({messages, tools})
    Note over LLM: LLM sees verify_declaration returned<br/>{success:true, data:{code:0, message:"{FLG:WISDOM}"}}<br/>→ No more tools needed

    LLM-->>Agent: response.output = [<br/>  {type:"message", content:"Phase 1: Documentation Explore..."}<br/>]<br/>No function_call items present

    Agent->>Agent: extractToolCalls(response) → []
    Note over Agent: toolCalls.length === 0<br/>→ Exit the loop

    Agent->>Tracer: record("agent.finish", {step:11, totalMessages:48})
    Agent-->>App: {response: "Phase 1: Documentation Explore..."}

    Note over App: Agent is done.<br/>Save tracer, close session, print stats.
```

**Why does the LLM stop?** Two reasons:
1. The system instructions say: *"If verify succeeds: report success and stop"*
2. The LLM observes `{success: true, code: 0, message: "{FLG:WISDOM}"}` in the last tool output and recognizes the task is complete

There is no code-level check for "flag found". The LLM itself decides to stop calling tools and emit a text summary instead. The agent loop simply checks: *"are there tool calls? no → return the text."*

**Key insight**: The agent has **no hardcoded control flow**. The LLM decides what to do next based on:
1. The **system instructions** (the pipeline defined in `config.js`)
2. The **conversation history** (all prior tool calls and results)
3. The **available tools** (10 tools: 4 MCP + 6 native)

The LLM acts as the "brain" — it reads documentation, decides which files to fetch, interprets content, builds the declaration, and iterates on errors. The code simply provides the loop and the tools.

---

## 5. Business Process — The 4 Phases

```mermaid
flowchart TD
    START([Start]) --> P1

    subgraph P1["Phase 1: Explore Documentation"]
        P1A[Fetch index.md from remote URL] --> P1B["LLM reads index.md content<br/>(42KB of SPK documentation)"]
        P1B --> P1C["LLM identifies [include] directives<br/>and attachment references"]
        P1C --> P1D["Fetch ALL referenced files in parallel<br/>zalacznik-A..H, dodatkowe-wagony,<br/>trasy-wylaczone.png"]
        P1D --> P1E{"Is file an image?"}
        P1E -->|Yes| P1F[Save to workspace/images/<br/>then analyze_image via Vision API]
        P1E -->|No| P1G[Save to workspace/documents/<br/>content returned to LLM directly]
        P1F --> P1H[Vision extracts text from image]
    end

    P1G --> P2
    P1H --> P2

    subgraph P2["Phase 2: Analyze & Build Knowledge"]
        P2A["LLM synthesizes ALL document contents<br/>from conversation history"] --> P2B["Extract key facts:<br/>• Template format (Załącznik E)<br/>• Route code X-01 (Gdańsk→Żarnowiec)<br/>• Category A,B exempt from fees<br/>• WDP calculation rules<br/>• Excluded route policies"]
        P2B --> P2C["fs_write → save template to<br/>workspace/templates/"]
        P2C --> P2D["update_knowledge → persist<br/>facts to knowledge.json"]
        P2D --> P2E["update_draft → persist<br/>field values to draft.json"]
    end

    P2 --> P3

    subgraph P3["Phase 3: Construct Declaration"]
        P3A["LLM constructs declaration text<br/>using template format + extracted values"] --> P3B["render_declaration tool"]
        P3B --> P3C{"Local validation<br/>passes?"}
        P3C -->|No| P3D["Return issues to LLM<br/>(e.g. 'Cost must be 0 PP')"]
        P3D --> P3A
        P3C -->|Yes| P3E["Save to workspace/drafts/<br/>final-declaration.txt"]
    end

    P3 --> P4

    subgraph P4["Phase 4: Verify & Iterate"]
        P4A["verify_declaration tool"] --> P4B{"Pre-verify<br/>validation"}
        P4B -->|Fail| P4C[Block submission<br/>return issues to LLM]
        P4C --> P3A
        P4B -->|Pass| P4D["POST to hub.ag3nts.org/verify"]
        P4D --> P4E{"Success?<br/>(code=0 or FLG)"}
        P4E -->|Yes| P4F([Done — Flag captured!])
        P4E -->|No| P4G["LLM reads error/hint<br/>adjusts declaration"]
        P4G --> P3A
    end
```

---

## 6. How the Agent Discovers and Selects Files

**This is the most interesting part architecturally.**

The agent **fetches ALL files** — it does not selectively pick only relevant ones. Here's exactly what happens, reconstructed from the trace:

```mermaid
sequenceDiagram
    participant LLM as LLM (GPT-5 Nano)
    participant FetchTool as fetch_remote_url
    participant VisionTool as analyze_image
    participant Docs as hub.ag3nts.org

    Note over LLM: Step 1 — System instructions say:<br/>"Fetch the documentation index"
    LLM->>FetchTool: fetch index.md
    FetchTool->>Docs: GET /dane/doc/index.md
    Docs-->>FetchTool: 42KB markdown document
    FetchTool-->>LLM: Full text content returned<br/>in tool_call_output

    Note over LLM: Step 2 — LLM reads the 42KB text,<br/>sees [include file="..."] directives<br/>and fetches ALL 10 files in parallel
    par Parallel fetch (10 files)
        LLM->>FetchTool: fetch zalacznik-E.md
        LLM->>FetchTool: fetch zalacznik-A.md
        LLM->>FetchTool: fetch zalacznik-B.md
        LLM->>FetchTool: fetch zalacznik-C.md
        LLM->>FetchTool: fetch zalacznik-D.md
        LLM->>FetchTool: fetch zalacznik-F.md
        LLM->>FetchTool: fetch zalacznik-G.md
        LLM->>FetchTool: fetch zalacznik-H.md
        LLM->>FetchTool: fetch dodatkowe-wagony.md
        LLM->>FetchTool: fetch trasy-wylaczone.png
    end

    Note over LLM: All text file contents are returned<br/>directly in tool outputs → LLM can read them

    Note over LLM: Step 3 — Image detected,<br/>needs Vision API to read
    LLM->>VisionTool: analyze trasy-wylaczone.png<br/>"Extract routes for Żarnowiec/Gdańsk"
    VisionTool->>VisionTool: Vision API call (31 seconds)
    VisionTool-->>LLM: Route X-01 Gdańsk→Żarnowiec<br/>excluded, category A/B only

    Note over LLM: Steps 4-6 — LLM re-fetches some<br/>files (redundant but harmless)

    Note over LLM: Step 7 — Synthesis step:<br/>LLM has all docs in context,<br/>calls fs_write + update_knowledge<br/>+ update_draft simultaneously
```

### Why "fetch ALL"?

The system instructions explicitly tell the agent:

> *"Fetch ALL attachments (zalacznik-A through H, dodatkowe-wagony, trasy-wylaczone, etc.). Do NOT skip any."*

This is a deliberate design choice:

1. **The LLM cannot predict** which attachment contains critical info until it reads it
2. **The index.md uses `[include file="..."]`** syntax — the LLM parses these references from the text and constructs URLs by prepending the base URL
3. **Some attachments return "access denied"** (e.g., A, B are restricted) — the agent handles this gracefully, noting the restriction and moving on
4. **The image (trasy-wylaczone.png)** requires a separate Vision API call — the `fetch_remote_url` tool saves it as binary and tells the LLM to use `analyze_image`

### The Discovery Chain

```mermaid
flowchart LR
    INDEX["index.md<br/>(42KB main doc)"] -->|"[include file='zalacznik-A.md']"| A["zalacznik-A.md<br/>(restricted)"]
    INDEX -->|"[include file='zalacznik-B.md']"| B["zalacznik-B.md<br/>(restricted)"]
    INDEX -->|"[include file='zalacznik-C.md']"| C["zalacznik-C.md<br/>(transport categories)"]
    INDEX -->|"[include file='zalacznik-D.md']"| D["zalacznik-D.md<br/>(error codes)"]
    INDEX -->|"[include file='zalacznik-E.md']"| E["zalacznik-E.md<br/>(DECLARATION TEMPLATE)"]
    INDEX -->|"[include file='zalacznik-F.md']"| F["zalacznik-F.md<br/>(network map)"]
    INDEX -->|"[include file='zalacznik-G.md']"| G["zalacznik-G.md<br/>(pricing details)"]
    INDEX -->|"[include file='zalacznik-H.md']"| H["zalacznik-H.md<br/>(regulations)"]
    INDEX -->|"[include file='dodatkowe-wagony.md']"| DW["dodatkowe-wagony.md<br/>(wagon capacity/pricing)"]
    INDEX -->|"[include file='trasy-wylaczone.png']"| TW["trasy-wylaczone.png<br/>(excluded routes IMAGE)"]

    E -.->|"Template used for"| DECL["Final Declaration"]
    TW -.->|"Vision API → Route X-01"| DECL
    DW -.->|"WDP = 4 wagons"| DECL
    C -.->|"Category A = exempt"| DECL
    INDEX -.->|"Fee table → 0 PP for A"| DECL

    style E fill:#2d6,stroke:#000,color:#fff
    style TW fill:#d62,stroke:#000,color:#fff
    style DW fill:#26d,stroke:#000,color:#fff
    style DECL fill:#fd0,stroke:#000,color:#000
```

---

## 7. Data Flow — From Raw Docs to Verified Declaration

```mermaid
flowchart TD
    subgraph "Input"
        REMOTE["Remote documentation<br/>hub.ag3nts.org/dane/doc/"]
        CONFIG["config.js<br/>Shipment params + instructions"]
    end

    subgraph "Processing (in LLM context)"
        FETCH["Downloaded docs<br/>(text in tool outputs)"]
        VISION_OUT["Vision extraction<br/>(image → text)"]
        SYNTHESIS["LLM synthesizes facts<br/>from all documents"]
    end

    subgraph "Persisted State"
        KNOWLEDGE["knowledge.json<br/>Route: X-01<br/>Exempt: A, B<br/>WDP: 4"]
        DRAFT["declaration-draft.json<br/>All field values"]
        TEMPLATE["declaration_template.txt<br/>Exact format from Załącznik E"]
    end

    subgraph "Output"
        FINAL["final-declaration.txt<br/>Complete filled declaration"]
        VALID{"Local validation<br/>10 regex checks"}
        SUBMIT["POST /verify"]
        FLAG["Flag: {FLG:WISDOM}"]
    end

    REMOTE --> FETCH
    FETCH --> SYNTHESIS
    VISION_OUT --> SYNTHESIS
    CONFIG --> SYNTHESIS

    SYNTHESIS --> KNOWLEDGE
    SYNTHESIS --> DRAFT
    SYNTHESIS --> TEMPLATE

    KNOWLEDGE --> FINAL
    DRAFT --> FINAL
    TEMPLATE --> FINAL

    FINAL --> VALID
    VALID -->|Pass| SUBMIT
    VALID -->|Fail| SYNTHESIS
    SUBMIT -->|Success| FLAG
    SUBMIT -->|Fail| SYNTHESIS
```

---

## 8. Tracing & Observability

The tracer is a **dependency-injected event recorder** created at startup and passed to every layer.

```mermaid
flowchart LR
    subgraph "Create"
        APP["app.js<br/>tracer = createTracer(sessionId)"]
    end

    subgraph "Inject"
        AGENT["agent.js<br/>receives tracer"]
        API["api.js<br/>chat({tracer})<br/>vision({tracer})"]
        TOOLS["tools.js<br/>handler(args, tracer)"]
    end

    subgraph "Collect"
        EVENTS["In-memory array<br/>133 events (typical run)"]
    end

    subgraph "Dump"
        FILE["workspace/traces/<br/>sessionId--timestamp.json<br/>Pretty-printed, human-readable"]
    end

    APP --> AGENT
    APP --> API
    APP --> TOOLS
    AGENT --> EVENTS
    API --> EVENTS
    TOOLS --> EVENTS
    EVENTS --> FILE
```

### Event Timeline (from actual run)

```mermaid
gantt
    title Agent Run Timeline - 11 steps, ~4 minutes
    dateFormat s
    axisFormat %S s

    section Phase 1 - Explore
    Fetch index.md                          :fetch1, 0, 10s
    Fetch 10 attachments in parallel        :fetch2, after fetch1, 10s
    Vision analysis of trasy-wylaczone.png  :vision, after fetch2, 32s
    Re-fetch index and dodatkowe-wagony     :refetch1, after vision, 15s
    Re-fetch zalacznik-E                    :refetch2, after refetch1, 1s

    section Phase 2 - Analyze
    Synthesis - fs_write, knowledge, draft  :synth, after refetch2, 67s

    section Phase 3 - Construct
    render_declaration FAIL - 0 not 0 PP   :crit, render1, after synth, 26s
    render_declaration PASS                 :render2, after render1, 22s

    section Phase 4 - Verify
    verify_declaration SUCCESS              :done, verify, after render2, 4s
    Final summary text generation           :summary, after verify, 43s
```

---

## 9. Tool Interaction Patterns

### 9.1 Hybrid Tool Architecture

The agent has two categories of tools:

```mermaid
graph TB
    subgraph "MCP Tools (via stdio server)"
        FS_READ["fs_read<br/>Read file from workspace"]
        FS_WRITE["fs_write<br/>Write file to workspace"]
        FS_SEARCH["fs_search<br/>Search file contents"]
        FS_MANAGE["fs_manage<br/>Create/delete/move files"]
    end

    subgraph "Native Tools (in-process JS)"
        FETCH["fetch_remote_url<br/>HTTP GET → save locally"]
        ANALYZE["analyze_image<br/>Vision API on local image"]
        KNOWLEDGE["update_knowledge<br/>Merge facts into JSON"]
        DRAFT_TOOL["update_draft<br/>Merge fields into JSON"]
        RENDER["render_declaration<br/>Save + validate declaration"]
        VERIFY["verify_declaration<br/>Validate + POST to API"]
    end

    AGENT["agent.js"] --> FS_READ
    AGENT --> FS_WRITE
    AGENT --> FS_SEARCH
    AGENT --> FS_MANAGE
    AGENT --> FETCH
    AGENT --> ANALYZE
    AGENT --> KNOWLEDGE
    AGENT --> DRAFT_TOOL
    AGENT --> RENDER
    AGENT --> VERIFY
```

**Why hybrid?** MCP provides a standardized filesystem interface, but domain-specific operations (HTTP fetching, verification API, structured JSON merging) need custom logic. The agent doesn't know the difference — both appear as function tools in the OpenAI Responses API format.

### 9.2 Validation Gate (Step 13)

```mermaid
flowchart TD
    AGENT["Agent calls<br/>render_declaration or verify_declaration"]
    VALIDATE["validateDeclaration()"]
    CHECK1{"Has header marker?"}
    CHECK2{"Has footer marker?"}
    CHECK3{"Has oath?"}
    CHECK4{"All 10 fields present?"}
    CHECK5{"Cost = 0 PP?"}
    CHECK6{"≥8 separator lines?"}

    AGENT --> VALIDATE
    VALIDATE --> CHECK1
    CHECK1 -->|No| FAIL
    CHECK1 -->|Yes| CHECK2
    CHECK2 -->|No| FAIL
    CHECK2 -->|Yes| CHECK3
    CHECK3 -->|No| FAIL
    CHECK3 -->|Yes| CHECK4
    CHECK4 -->|No| FAIL
    CHECK4 -->|Yes| CHECK5
    CHECK5 -->|No| FAIL
    CHECK5 -->|Yes| CHECK6
    CHECK6 -->|No| FAIL
    CHECK6 -->|Yes| PASS

    FAIL["Return issues list<br/>to LLM for correction"]
    PASS["Proceed to save/submit"]

    style FAIL fill:#d33,color:#fff
    style PASS fill:#3d3,color:#fff
```

In the actual run, the first `render_declaration` call failed validation because the agent wrote `KWOTA DO ZAPŁATY: 0` instead of `KWOTA DO ZAPŁATY: 0 PP`. The validation caught this, returned the issue, and the agent corrected it on the next attempt.

---

## 10. Session & Post-Run Analysis

After the agent finishes, `app.js` scans the tracer event array to extract structured insights:

```mermaid
flowchart LR
    EVENTS["133 tracer events"] --> SCAN["extractSessionInsights()"]
    SCAN --> DECISIONS["importantDecisions[]<br/>• knowledge_update timestamps<br/>• declaration_rendered + valid?"]
    SCAN --> ATTEMPTS["verifyAttempts[]<br/>• timestamp, success, code, message"]
    SCAN --> VALIDATIONS["validations[]<br/>• timestamp, valid, issues[]"]

    DECISIONS --> SESSION["session.json"]
    ATTEMPTS --> SESSION
    VALIDATIONS --> SESSION
```

This means you can look at just the session file for a high-level summary, or dive into the full trace for step-by-step debugging.

---

## 11. File Map

```
01_04_zadanie/
├── app.js                              # Entrypoint
├── package.json                        # Dependencies
├── mcp.json                            # MCP server config (files-mcp)
├── specs/
│   ├── prompt-start.md                 # Original exercise prompt
│   ├── SPEC_SENDIT_STEP_BY_STEP.md     # 16-step implementation guide
│   └── ARCHITECTURE.md                 # ← This file
├── src/
│   ├── agent.js                        # Orchestration loop
│   ├── config.js                       # Model, instructions, task params
│   ├── helpers/
│   │   ├── api.js                      # LLM chat + vision (with tracer)
│   │   ├── logger.js                   # Console output + verbose mode
│   │   ├── response.js                 # Extract text from API response
│   │   ├── shutdown.js                 # SIGINT/SIGTERM handler
│   │   └── stats.js                    # Token usage counter
│   ├── mcp/
│   │   └── client.js                   # MCP stdio client
│   ├── native/
│   │   └── tools.js                    # 6 native tools + validation
│   └── services/
│       ├── trace-logger.js             # Dependency-injected event recorder
│       └── session-manager.js          # Session lifecycle management
└── workspace/                          # Generated at runtime (deletable)
    ├── documents/                      # Downloaded .md files
    ├── images/                         # Downloaded .png files
    ├── notes/knowledge.json            # Extracted facts
    ├── templates/                      # Declaration template
    ├── drafts/                         # Draft JSON + final .txt
    ├── verify-logs/                    # Each verify attempt
    ├── sessions/                       # Session metadata
    └── traces/                         # Full event traces
```

---

## 12. Key Learning Points

1. **The LLM is the orchestrator** — there is no `if/else` control flow deciding what to fetch or how to fill fields. The system instructions define the pipeline; the LLM follows it, making decisions based on document content.

2. **Tool outputs are the LLM's "eyes"** — when `fetch_remote_url` returns a document's full text, that text goes into the conversation history. The LLM literally reads the documentation. This is why the agent fetches everything: it needs the content in its context window.

3. **`[include file="..."]` is not parsed by code** — the LLM reads this syntax in the index.md text and decides to construct URLs for each file. This is emergent behaviour guided by the system instructions.

4. **Local validation catches formatting errors before wasting API calls** — the `0` vs `0 PP` issue was caught deterministically, saving a round-trip to the verify endpoint.

5. **The tracer-as-dependency pattern** makes every layer observable without coupling layers to each other. The tracer is just a `{ record, save }` object.

6. **Workspace is ephemeral** — delete it entirely and re-run. Everything regenerates. This makes debugging easy: just look at the workspace after a run.
