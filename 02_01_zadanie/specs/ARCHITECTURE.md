# ARCHITECTURE — `categorize` Exercise

> How the pieces fit together, what each component owns, and how data/events flow between them. The foundation is the `01_05_agent` runtime; this document describes the deltas and additions.

---

## 1. System Overview

```
                        ┌─────────────────────────────────────────────────────┐
                        │                    Hub (ag3nts.org)                  │
                        │   GET  /data/{key}/categorize.csv   — returns CSV    │
                        │   POST /verify                      — per-item call  │
                        │         body: { apikey, task, answer:{prompt} }      │
                        │         prompt is RENDERED by us (placeholders       │
                        │         already substituted for one CSV row)         │
                        │         returns classifier output per POST; flag     │
                        │         returned when all 10 correct in an attempt   │
                        │   reset: POST /verify answer.prompt = "reset"        │
                        └───────────────▲─────────────────────┬────────────────┘
                                        │  GET CSV            │  POST /verify × 10 per attempt
                                        │                     │
┌───────────┐                           │                     │
│   CLI /   │                           │                     │
│ optional  │                           │                     │
│  HTTP     │                           │                     │
└─────┬─────┘                           │                     │
      │  startRun()                     │                     │
      ▼                                 │                     │
┌────────────────────────────────────────────────────────────────────────────┐
│                            Categorize Runner                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ RunManager   │  │ CSV download │  │ Prompt       │  │ Hub Client   │   │
│  │ (sessions+   │  │   + parser   │  │  Builder +   │  │ (per-item    │   │
│  │  runs+agent) │  └──────────────┘  │  Renderer +  │  │  submit,     │   │
│  │              │                    │  Validator + │  │  reset)      │   │
│  │              │                    │  Strategy    │  │              │   │
│  └──────┬───────┘                    └─────┬────────┘  └─────▲────────┘   │
│         │                                  │                 │            │
│         │                                  ▼                 │            │
│         │                         ┌────────────────┐         │            │
│         │                         │ Token Estimator│─────────┘            │
│         │                         │  (tiktoken)    │  worst-case gate +   │
│         │                         │                │  per-POST gate       │
│         │                         └────────┬───────┘                      │
│         │                                  │                              │
│         │                         ┌────────▼───────┐                      │
│         │                         │ Budget Tracker │                      │
│         │                         └────────┬───────┘                      │
│         │                                  │                              │
│         │                         ┌────────▼────────┐     ┌─────────────┐ │
│         │                         │   Optimizer /   │◀────│ Opus Client │ │
│         │                         │    Refiner      │     │ (provider   │ │
│         │                         └────────┬────────┘     │  registry)  │ │
│         │                                  │              └─────────────┘ │
│         ▼                                  ▼                              │
│  ┌──────────────────────────────────────────────────────────────┐         │
│  │        Event Emitter (existing AgentEventEmitter)            │         │
│  └───────┬────────────────────────┬────────────────────────┬────┘         │
└──────────┼────────────────────────┼────────────────────────┼──────────────┘
           │                        │                        │
           ▼                        ▼                        ▼
   ┌────────────────┐      ┌─────────────────┐      ┌──────────────────┐
   │  Event Logger  │      │    Langfuse     │      │   Repositories   │
   │    (Pino)      │      │   Subscriber    │      │ (Drizzle + SQLite│
   │                │      │   (OTel spans)  │      │    or memory)    │
   └────────────────┘      └─────────────────┘      └──────────────────┘
                                                              │
                                                              ▼
                                                   ┌──────────────────────┐
                                                   │ runs, csv_items,     │
                                                   │ prompt_versions,     │
                                                   │ hub_submissions,     │
                                                   │ refinements,         │
                                                   │ budget_usage,        │
                                                   │ failure_analyses     │
                                                   │ + existing           │
                                                   │ (users, sessions,    │
                                                   │  agents, items)      │
                                                   └──────────────────────┘
```

Everything inside `Categorize Runner` is new. Everything below (events, logger, Langfuse, repositories) is the existing `01_05_agent` infrastructure extended with new event types and new tables.

**Per-attempt cadence**: one iteration issues 10 per-item POSTs back-to-back (row 0..9), aborting on the first misclassification. Flag arrives with the 10th per-item response when all classifications are correct. Resets are their own POSTs, counted separately.

---

## 2. Component Inventory & Responsibilities

### 2.1 Orchestrator — `categorize/runner.ts`

**Role**: the single deterministic driver. Mirrors the discipline of `01_05_agent`'s `runtime/runner.ts`: a tight state machine with explicit transitions.

**Responsibilities**:
- Own the run lifecycle: `pending → running → waiting → completed/failed/cancelled`.
- Coordinate the loop: `download CSV → persist items → build template → validate → worst-case tokenize → budget check → for each of 10 items: render → per-POST budget/token gate → submit → parse → (abort on misclassification) → (reset if hub counter exhausted) → evaluate → (refine)`.
- Be the only component allowed to write final state on `runs`, `prompt_versions`, and to flip `winning_version_id`.
- Emit every event; never short-circuit observability.
- Respect `AbortSignal` (graceful SIGINT, same contract as `01_05_agent`).

**Not responsibilities** (delegated):
- No HTTP to the hub (hub client does it).
- No tokenization (estimator does it).
- No cost math (budget tracker).
- No Opus interaction (refiner).
- No schema mapping (repositories).

### 2.2 Hub Client — `categorize/hub/client.ts` + `categorize/hub/parser.ts`

**Role**: single HTTP surface to `https://hub.ag3nts.org/verify` (per-item submissions + resets) and `https://hub.ag3nts.org/data/{key}/categorize.csv` (CSV download).

**Responsibilities**:
- Build the submit request body: `{ apikey, task: 'categorize', answer: { prompt: <renderedPrompt> } }`.
- `submit(renderedPrompt: string)` — one POST per item; returns the full response + http status + duration.
- `reset()` — submit with `answer.prompt = "reset"`; same endpoint, distinct method for call-site clarity.
- Apply retry policy with exponential backoff on 5xx/timeout (bounded attempts). Do NOT retry 4xx or semantic failures — those are returned to the caller for orchestration to decide.
- Return a `Result<HubResponse, HubError>`; never throw across the boundary.
- Record `startTime, durationMs, rawStatus, rawBody` for tracing and DB persistence.

`parser.ts` separately:
- Validates response shape via Zod (schema is permissive — hub's exact payload is discovered at runtime).
- Extracts `flag` from the response body by scanning for `{FLG:...}` pattern.
- Extracts classifier output text and normalizes via `normalize.ts` → `DNG | NEU | INVALID`.
- Extracts `hubError`, `hubCounterRemaining` if present.
- Produces `{ flag?: string, classifierOutput?: string, normalized?: 'DNG'|'NEU'|'INVALID', hubError?: string, hubCounterRemaining?: number, usage?: Usage }`.

**Extension points**:
- Hub-reported token/cost numbers (if any) surfaced in `usage` so the estimator can calibrate per-item.
- Hub-side attempt-counter info surfaced so the runner can decide preemptive resets.

### 2.3 CSV Downloader + Parser — `categorize/csv/*`

**Role**: materialize the 10 items into DB and discover the column list that prompts may reference as placeholders.

**Responsibilities**:
- `downloader.ts`: fetch raw CSV bytes from `https://hub.ag3nts.org/data/{API_KEY}/categorize.csv`, compute `sha256`, persist raw bytes into `runs.raw_csv` (text, small — 10 rows) with the hash.
- `parser.ts`: decode CSV (RFC 4180), detect column list, emit `CsvItem[]`, persist via `csvItemRepo.bulkInsert`. Export `columnNames: string[]` for the prompt validator.
- Validate row count is exactly 10; abort run with `failed(reason='csv_shape')` if not.

### 2.4 Prompt Builder + Renderer + Strategy + Validator — `categorize/prompt/*`

**Role**: compose the prompt **template** (with placeholders), render it against each CSV row before dispatch, and verify candidates are structurally valid.

**Responsibilities**:
- `builder.ts`: pure function `build(prefix, outputContract, placeholderLine) → PromptTemplate`. Guarantees the placeholder line is always last.
- `renderer.ts`: pure function `render(template: PromptTemplate, csvRow: CsvItem) → renderedPrompt: string`. Substitutes every `{col}` token in the placeholder line with the CSV row's column value; throws if a placeholder has no matching column (defensive — the validator should have caught it earlier).
- `strategy.ts`:
  - `createVersion(base | refinement)` → new `PromptVersion` row with monotonic `iteration_no`, content hash, prefix hash.
  - `classifyMutation(prev, next)` → `A | B | C | D` (see SPEC §8).
  - `prefixHash(v)` + longest-common-prefix scoring vs previous version.
- `validator.ts`:
  - extract placeholders from the template via regex `\{([a-zA-Z_][a-zA-Z0-9_]*)\}`;
  - assert every placeholder ∈ `csvColumnNames` — else `unknown_placeholder`;
  - assert every required invariant (SPEC §7.4) is present in the prefix — else `invariant_removed`;
  - compute `estimateWorstCase(template, csvItems)` and assert `worstTotal ≤ 100` — else `exceeds_100_tokens`;
  - return a typed `ValidationResult` with a reject reason when a gate fails.

### 2.5 Token Estimator — `categorize/tokens/estimator.ts`

**Role**: the single source of truth for token counts.

**Responsibilities**:
- Lazy-init the tiktoken encoder (configurable).
- `estimateText(text)` — generic counter (used for Opus context sizing and heuristic fallback).
- `estimateRendered(prefix, contract, renderedTail)` — token count for one concrete per-item rendering (what the hub sees on input).
- `estimateWorstCase(template, csvItems)` — renders every one of the 10 CSV rows and returns `{ prefixTokens, perItemTokens[], worstItemTokens, worstTotal }`. This is the canonical gate input.
- Emit a `tokens.estimated` event for each call (opt-in debug).
- Provide `maxAllowed = 100` as a constant visible to all callers.
- **Never exposed as a tool**. No `Tool` object is registered in `ToolRegistry` for it. The optimizer receives token numbers as plain text in its prompt.

### 2.6 Budget Tracker — `categorize/budget/tracker.ts`

**Role**: running ledger for USD, input/output tokens, submissions, iterations, resets.

**Responsibilities**:
- In-memory accumulator backed by `budget_usage` rows (append-only audit log).
- `canAfford(plan: EstimatedCost): boolean` — used before every per-item hub POST, every reset, every Opus call, and at iteration start (to cover the expected 10-POST attempt).
- `record(actual: ObservedCost)` — posts a `budget.consumed` event and a DB row.
- `breach(detail)` — posts `budget.breached` and flips the orchestrator into `stopping` state.
- Counters: `submissionsMade` (per-item POSTs), `resetsUsed`, `opusCallsMade` — independently capped.
- Config: hard USD cap, hard `CATEGORIZE_MAX_RESETS`, and soft warn threshold (default: 80% → log warning).

### 2.7 Optimizer / Refiner — `categorize/optimizer/*`

**Role**: call Claude Opus as a strictly text-in, JSON-out advisor.

**Responsibilities**:
- `opus-client.ts`: thin wrapper around the existing provider registry. Resolves the Opus model id (e.g. `anthropic:claude-opus-*` via Anthropic SDK or `openrouter:anthropic/claude-opus-*`). Sets `temperature ≤ 0.3`, `max_output_tokens ≤ 1000`.
- `refiner.ts`:
  - assemble advisor context (task brief + current candidate + failure digest + budget snapshot + mutation rules + optional prior refinements);
  - call Opus through provider registry;
  - validate JSON via Zod (`parser.ts`);
  - on parse failure: one corrective retry; on second failure: invoke deterministic shrinker fallback.
- Persist a `refinements` row with input digest, output, decision, cache_impact, cost.

**Critical rule**: the refiner never sends the proposal to the verifier. It returns it to the orchestrator, which runs the independent tokenize → gate → persist pipeline before any dispatch.

### 2.8 Run / Session Manager — `categorize/sessions/run-manager.ts`

**Role**: encapsulate session + run + root-agent creation and resumption.

**Responsibilities**:
- Create a triad `(session, run, rootAgent)` in a single logical unit.
- Link runs to `experimentLineageId` when `--continue-lineage` is requested.
- Resume: given a `runId`, rehydrate last `prompt_versions`, last `budget_usage`, last `hub_submissions`, decide next step based on `runs.status`.
- Finalize: flip `runs.status`, set `completed_at`, write `result` JSON, propagate to the root agent row.

### 2.9 Trace Logger — reused `lib/event-logger.ts` + `lib/langfuse-subscriber.ts`

**Role**: subscribe to the event emitter and produce Pino logs + Langfuse spans.

**Extensions for categorize**:
- `event-logger.ts` gains cases for `run.*`, `iteration.*`, `verify.*`, `reset.*`, `refine.*`, `budget.*`.
- `langfuse-subscriber.ts` gains handlers that:
  - treat `run.started` as the top-level trace and create an agent observation;
  - treat `iteration.started` as a nested span (`asType: 'span'`) that parents the 10 within-attempt generations;
  - treat `verify.completed` as a generation (`asType: 'generation'`, model = `hub:categorize`, one per per-item POST);
  - treat `reset.performed` as a generation (`asType: 'generation'`, model = `hub:categorize`, tagged `isReset=true`);
  - treat `refine.completed` as a generation (`asType: 'generation'`, model = `anthropic:claude-opus-*`);
  - attach cumulative `costUsd` and `cachedTokens` to the root trace metadata on every `budget.consumed`.

### 2.10 DB Persistence Layer — reused repositories pattern

**Role**: Drizzle-backed repositories mirroring `01_05_agent/src/repositories/sqlite/index.ts`.

**New repositories**:
- `runRepo` — CRUD + state transitions for `runs`.
- `csvItemRepo` — bulk insert + list by run.
- `promptVersionRepo` — insert, list by run, fetch by id, update `winning` flag.
- `hubSubmissionRepo` — insert pending, mark ok/error, list by `(runId, promptVersionId)`, store raw request/response bodies.
- `refinementRepo` — insert, list by run.
- `budgetUsageRepo` — append + sum.
- `failureAnalysisRepo` — insert + list by iteration.

Each one also exists in the in-memory variant (`repositories/memory.ts`) for tests, with identical contracts.

---

## 3. Runtime Context Extension

Extending `01_05_agent`'s `RuntimeContext`:

```
RuntimeContext (existing)
  events: AgentEventEmitter
  repositories: Repositories  ← extended to include categorize repos
  tools: ToolRegistry
  mcp: McpManager
  categorize: CategorizeFacet  ← NEW, only populated if categorize is enabled
    hub: HubClient
    tokenizer: TokenEstimator
    budget: BudgetTrackerFactory
    optimizer: OpusRefiner
```

`ExecutionContext` gains (for categorize paths only):

```
ExecutionContext (existing): traceId, rootAgentId, parentAgentId?, depth, userId?, userInput?, agentName?
  + runId: RunId
  + iterationNo: number
  + promptVersionId?: PromptVersionId
```

The existing `createEventContext` remains the shaping authority; categorize adds `runId` and `iterationNo` as additional fields carried on every emitted event.

---

## 4. Event Flow — One Iteration (10 per-item POSTs)

```
runner.ts                          emitter                  subscribers
────────                           ────────                 ───────────────────
runStart()                         run.started          ──▶ logger, langfuse(create trace+agent obs)

iterationStart(v)                  iteration.started    ──▶ logger, langfuse(span opens)
  build template
  validator.check (placeholders ⊆ cols, invariants, worst-case ≤ 100)   (hard gate, no event)
  budget.canAfford(10 * perPostCost + maybeOpusCost)  (may emit budget.breached)

  for row in csvItems (0..9):
    rendered = renderer.render(template, row)
    estimator.estimateText(rendered)                     (defensive per-POST gate)
    budget.canAfford(perPostCost)                        (may emit budget.breached)
    persist hub_submissions row (kind='submit', status='pending', renderedPrompt)
    verify.called                  verify.called        ──▶ logger
    hubClient.submit(rendered)
      on ok:
        parser.parse → { normalized, flag?, hubError?, counter? }
        update hub_submissions (status='ok', raw response, normalized, match?)
        budget.consumed (scope='verify')               ──▶ logger, langfuse(metadata)
        verify.completed                                ──▶ logger, langfuse(generation)
        if normalized is misclassification:
          break (abort remaining POSTs of this attempt)
        if flag found on response:
          record flag on runs + prompt_versions
          break (success)
      on error / 5xx:
        update hub_submissions (status='error')
        verify.failed                                   ──▶ logger, langfuse(error span)
        break (escalate)

  iteration.completed { correct, incorrect, invalid, errors, flag? }
                                                        ──▶ logger, langfuse(span closes)

if hub counter exhausted detected from any per-item response:
  persist hub_submissions row (kind='reset', status='pending')
  hubClient.reset()
  update hub_submissions (status='ok')
  reset.performed                                       ──▶ logger, langfuse(generation; isReset=true)
  budget.consumed (scope='reset')                       ──▶ logger

if flag not found & iterations left & budget ok:
  refiner.propose(candidate, digest)
                                   refine.requested    ──▶ logger
                                   (Opus call auto-traced)
                                   refine.completed    ──▶ logger, langfuse(generation)
                                   budget.consumed     ──▶ logger, langfuse(metadata)

runner finalizes                   run.completed | run.failed ──▶ logger, langfuse(trace.end)
```

---

## 5. Data Flow — Write-Ahead Discipline

Mirrors `01_05_agent`'s item persistence discipline: write the intent before the external call, then mutate to the final state after.

- **hub_submission** (kind=`submit`): insert one row per `(iteration, csv_item)` with `status='pending'`, the `renderedPrompt`, and the full request body before HTTP dispatch → update to `ok|error` after response, including raw response body, `normalized`, `match`, and any `flag`.
- **hub_submission** (kind=`reset`): insert with `status='pending'` before the reset POST → update to `ok|error`.
- **refinement**: insert `status='pending'` before Opus call → update with response + parsed decision.
- **prompt_version**: insert with `prefix_tokens`, `worst_item_tokens`, `total_tokens_worst_case` computed *before* any dispatch; if any validator gate fails, status stays `rejected` and we move on.
- **budget_usage**: append-only; we never retroactively delete rows (same integrity the `items` table has).

This guarantees a crashed process leaves a recoverable trail: any row in `pending` is known-interrupted and can be re-attempted or marked `abandoned` on resume.

---

## 6. Reuse vs New — Component Matrix

| Component | Source | Status | Notes |
|---|---|---|---|
| Hono app + middleware | `01_05_agent` | reuse | CLI variant doesn't start Hono, but the same app boots if categorize is exposed via HTTP. |
| Config (Zod env) | `01_05_agent` | extend | + HUB_*, OPUS/ANTHROPIC, BUDGET, MAX_ITERATIONS, PROMPT_MODEL. |
| Pino logger | `01_05_agent` | reuse | Per-module child logger. |
| OpenTelemetry + Langfuse | `01_05_agent` | reuse | Same `startObservation` helpers; subscriber extended. |
| Event emitter + types | `01_05_agent` | extend | +run/iteration/verify/refine/budget events. |
| Event logger | `01_05_agent` | extend | +new cases. |
| Langfuse subscriber | `01_05_agent` | extend | +span/generation mapping for new events. |
| Drizzle schema | `01_05_agent` | extend | +7 new tables. |
| SQLite repositories | `01_05_agent` | extend | +7 new repos, same patterns. |
| In-memory repositories | `01_05_agent` | extend | Mirror for tests. |
| Provider registry (OpenAI/Gemini/OpenRouter) | `01_05_agent` | reuse | Opus accessed via Anthropic or OpenRouter adapter. |
| Tool registry | `01_05_agent` | reuse | **No** tokenizer tool added (explicit design rule). |
| MCP manager | `01_05_agent` | unused | Kept intact for other agents. |
| Agent domain + state machine | `01_05_agent` | reuse | Root orchestrator modeled as an Agent of task `categorize`. |
| Session domain | `01_05_agent` | reuse | One session per run; `experimentLineageId` via new column. |
| Item polymorphic table | `01_05_agent` | reuse | Used only if we record Opus advisory turns as items (optional). |
| Workspace loader (markdown) | `01_05_agent` | reuse | Hosts `opus-prompt-engineer.agent.md`. |
| Runner (agentic loop) | `01_05_agent` | NOT reused for categorize | Different control shape; we build a dedicated deterministic runner. |
| `utils/tokens.ts` heuristic | `01_05_agent` | fallback only | Primary is `tiktoken`. |
| `utils/pruning.ts`, `utils/summarization.ts` | `01_05_agent` | unused | Prompts are tiny; no pruning needed. |

---

## 7. Cross-Cutting Concerns

### 7.1 Error Handling

- All external calls return `Result<T, E>`; no throws across module boundaries.
- Orchestrator has one top-level try/catch that maps unknown errors to `run.failed(reason='internal')` and re-throws only for the process-level `main()` safety net.
- Hub errors have their own taxonomy: `network`, `timeout`, `auth`, `rate_limited`, `5xx`, `bad_request`, `parse`.
- Opus errors: `parse`, `rate_limited`, `over_budget`, `provider_down`.

### 7.2 Concurrency

- Each iteration issues **up to 10 sequential** POSTs to `/verify`, one per CSV row in row order. Sequentiality is deliberate:
  - preserves cache warmth (rows 2..10 benefit from row 1's prefix being cached);
  - allows fail-fast abort on the first misclassification (skipping wasted spend);
  - trivially bounds rate-limit exposure.
- Iterations themselves are sequential (we need the previous iteration's failure digest to decide the next prompt version).
- Opus calls are strictly sequential, at most one per iteration boundary.
- Bounded parallelism (e.g. 2–3 concurrent per-item POSTs) is technically possible if the hub permits it but is **not** enabled in v1 — the win on wall-clock time is small, and fail-fast + cache warmth are higher-value.

### 7.3 Idempotency

- Per-item submit dedupe key: `(runId, promptVersionId, csvItemId, kind='submit')` — at most one submit row per item per prompt version per run. If a row exists in `pending` on resume, we re-issue and update-in-place; if `ok|error`, we do not re-issue.
- Reset submissions are tracked as `hub_submissions` rows with `kind='reset'` and `csv_item_id = NULL`. Multiple resets per run are possible, capped by `CATEGORIZE_MAX_RESETS`.
- Prompt version dedupe: content hash uniqueness per run (we may reuse a version number if the body is identical, tracked in `prompt_versions.duplicate_of`).

### 7.4 Security

- Hub key + Anthropic/OpenRouter key loaded only from env.
- No secrets in logs or traces (scrubbed via existing Pino redaction conventions; extended with `hubApiKey`, `anthropicApiKey`).
- No secrets in DB.

### 7.5 Graceful Shutdown

- SIGINT: abort any in-flight fetch via `AbortController`, flush pending DB writes, emit `run.cancelled`, shutdown tracing (existing `shutdownTracing()` reused).
- Hard deadline reused from `01_05_agent`: `SHUTDOWN_TIMEOUT_MS`.

---

## 8. Sequence Diagrams (text form)

### 8.1 Happy Path (iteration succeeds on 10th POST)

```
CLI        RunManager    Downloader  Validator  Estimator  Renderer  Budget   HubClient    Logger/LF
 │ startRun()  │             │           │         │          │         │          │
 │─────────────▶│            │           │         │          │         │          │
 │             │ run.started ┼───────────┼─────────┼──────────┼─────────┼──────────┼────▶
 │             │ download() ▶│           │         │          │         │          │
 │             │◀── csv(10) ─│           │         │          │         │          │
 │             │ parse + persist items + columnNames                                │
 │             │ build v0                                                            │
 │             │ validator.check (placeholders ⊆ cols, invariants, worst-case) ▶   │
 │             │◀── ok (worstTotal=92) ───────                                      │
 │             │ canAfford(10*perPostCost) ────────────────────────────▶           │
 │             │◀── ok                                                              │
 │             │ iteration.started ───────────────────────────────────────────────▶│
 │             │                                                                    │
 │             │ for row in items (0..9):                                          │
 │             │   render(template, row) ─────▶                                    │
 │             │◀── renderedPrompt ────                                             │
 │             │   estimateText(rendered) ─────▶                                   │
 │             │◀── 88 tokens (ok)                                                  │
 │             │   canAfford(perPostCost) ──────────────────────▶                  │
 │             │◀── ok                                                              │
 │             │   persist hub_submissions (pending)                                │
 │             │   verify.called ──────────────────────────────────────────────────▶│
 │             │   submit(rendered) ───────────────────────▶ POST /verify          │
 │             │                                              ◀── DNG|NEU[, flag]  │
 │             │   update hub_submissions (ok, match=true)                          │
 │             │   budget.consumed (verify) ───────────────────────────────────────▶│
 │             │   verify.completed ───────────────────────────────────────────────▶│
 │             │   if flag present → break                                          │
 │             │                                                                    │
 │             │ iteration.completed(correct=10, flag=...) + run.completed ───────▶│
 │◀── result ──│                                                                    │
```

### 8.2 Refinement Loop

```
... (previous iteration: POST #4 returned misclassification; remaining POSTs aborted; no flag) ...

RunManager       Refiner                 Opus (via providers)     Budget
    │  build digest from per-item hub_submissions of last iteration
    │    (rendered prompt, normalized outputs per row, which row failed, hub error)
    │  refine.requested ─────────────────────────────────────────────▶
    │  advise() ────────▶
    │                  canAfford(estOpusCost) ─────────────────────▶
    │                  callOpus(prompt=advisorContext)
    │                                         ─────▶ Opus
    │                                         ◀───── JSON proposal
    │                  parse + validate
    │                  record refinements row
    │                  budget.consumed (scope='opus') ──────────────▶
    │◀─── proposal ────│
    │  validator.check (invariants + placeholders + worst-case tokens)
    │  mutate class (prefix_preserved) → persist prompt_versions row
    │  next iteration → 10 per-item POSTs (see 8.1)
```

### 8.3 Reset Flow

```
RunManager      HubClient
    │  previous submission returned "counter exhausted" signal
    │  budget.canAfford(reset cost) ───▶
    │◀──────── ok
    │  reset() ────────────▶ POST /verify { answer: { prompt: "reset" } }
    │                         ◀─── ack
    │  reset.performed ─────────────────────▶ logger/LF
    │  budget.consumed ─────────────────────▶
    │  resetsUsed++
    │  if resetsUsed > CATEGORIZE_MAX_RESETS → finalize run.failed(reason='resets_exhausted')
    │  else → next iteration resubmits current best version
```

### 8.4 Budget Breach

```
RunManager      Budget
    │  canAfford(next attempt = 10*perPostCost [+ reset] [+ opus]) ─▶
    │◀──────── false (would exceed cap)
    │  budget.breached ────▶ logger/LF
    │  finalize: run.failed(reason='budget')
    │  persist best-so-far prompt version pointer
```

---

## 9. Module Boundaries & Dependency Rules

- `domain/categorize/*` depends on nothing except domain primitives.
- `categorize/prompt/*`, `categorize/tokens/*`, `categorize/budget/*` are pure modules with no I/O; they can be unit-tested in isolation.
- `categorize/hub/*`, `categorize/csv/*`, `categorize/optimizer/*` are I/O modules; they receive dependencies (fetch, provider registry, clock) via constructor injection for testability.
- `categorize/runner.ts` is the only module that wires everything; no other module imports the runner.
- `categorize/sessions/run-manager.ts` is the only module that calls repository writes on run lifecycle; the runner calls it, never the repos directly.

---

## 10. Environment & Configuration (delta only)

| Var | Purpose | Default |
|---|---|---|
| `HUB_BASE_URL` | Hub API root | `https://hub.ag3nts.org` |
| `HUB_API_KEY` | Hub API key (used in CSV URL path and request body `apikey`) | — required |
| `CATEGORIZE_TASK_NAME` | Hub task slug (`task` field in body) | `categorize` |
| `ANTHROPIC_API_KEY` | Opus access (direct) | — one of two |
| `OPENROUTER_API_KEY` | Opus access (via OpenRouter) | — one of two |
| `CATEGORIZE_OPUS_MODEL` | Opus model id | `anthropic:claude-opus-4-1` |
| `CATEGORIZE_BUDGET_USD` | Hard USD cap per run | `5.00` |
| `CATEGORIZE_MAX_ITERATIONS` | Prompt-version cap | `8` |
| `CATEGORIZE_MAX_RESETS` | Hard cap on `reset` submissions per run | `2` |
| `CATEGORIZE_PER_POST_FLAT_COST_USD` | Assumed cost per per-item hub POST when hub doesn't report usage | `0.0001` |
| `CATEGORIZE_RESET_FLAT_COST_USD` | Assumed cost per reset POST | `0.0001` |
| `CATEGORIZE_PROMPT_ENCODING` | tiktoken encoding | `cl100k_base` |
| `CATEGORIZE_E2E_REAL_OPUS` | Enable real Opus in E2E tests | `0` |

Existing vars (`DATABASE_URL`, `LANGFUSE_*`, `LOG_LEVEL`, `NODE_ENV`, `SHUTDOWN_TIMEOUT_MS`, etc.) are reused unchanged.

---

## 11. Summary

- The existing `01_05_agent` runtime, event system, tracing stack, and repository patterns are the load-bearing beams.
- New modules plug in cleanly, follow the same discipline (events over direct coupling, domain-first types, write-ahead DB), and don't leak implementation details across boundaries.
- Opus is a sandboxed advisor: zero tools, zero orchestration authority, zero access to tokenization or to the hub.
- The tokenizer is infrastructure, not a tool.
- The run is a finite state machine with explicit transitions, fully observable, fully replayable from the DB and trace alone.
