# SPEC — `categorize` Exercise

> Spec-driven plan for a new exercise that reuses the `01_05_agent` architecture as its foundation. No code in this document — only behaviour, contracts, and decisions.

---

## 0. TL;DR

Build a deterministic Node.js/TypeScript program that:

1. Downloads a fresh CSV of 10 items from `https://hub.ag3nts.org/data/{API_KEY}/categorize.csv` before every attempt.
2. Maintains one **prompt template** with placeholders (`{id}`, `{description}`, ...). For each CSV row it **renders** the template client-side and POSTs the rendered prompt to `https://hub.ag3nts.org/verify` — **10 POSTs per attempt, one per item**. Every *rendered* prompt must be ≤ 100 tokens.
3. The hub's tiny classifier emits `DNG` or `NEU` per POST. When all 10 classifications are correct the hub returns a `{FLG:...}` flag. On misclassification or budget exhaustion it returns an error response; the run then sends `{ "prompt": "reset" }` to restart the hub-side counter and starts a fresh attempt.
4. Iteratively refines the prompt template with the help of a **stronger external LLM (Claude Opus)** acting as a prompt engineer/advisor — never as the orchestrator.
5. Persists every artifact (runs, sessions, prompt versions, per-item submissions, resets, budget usage, refinements) so any run is fully replayable.
6. Reuses the existing `01_05_agent` patterns end-to-end: event-driven runtime, Drizzle+SQLite repositories, Langfuse/OTel tracing, Pino logs, session/agent model, deterministic orchestrator.

---

## 1. Goals & Non-Goals

### Goals

- **Correctness**: obtain the `{FLG:...}` flag, i.e. all 10 items classified correctly as `DNG` or `NEU` by the hub's tiny model.
- **Token discipline**: every *rendered* prompt POSTed to the hub ≤ 100 tokens (including the substituted item data), measured deterministically in code with `tiktoken`. Candidates are gated on worst-case rendered length before any dispatch.
- **Prompt caching as a first-class citizen**: stable prefix + dynamic suffix; mutation policy explicitly designed to preserve cache hits across the 10 within-iteration POSTs *and* across iterations.
- **Domain invariants preserved**: hard classification rules (e.g. "reactor parts are always NEU, even when their description sounds alarming") are part of the static prefix and Opus is instructed never to remove them while compressing.
- **Budget awareness**: every hub submission, every Opus call, and every retry is costed, tracked, and capped.
- **Observable & replayable**: full Langfuse trace + DB state for every run, every iteration, every prompt version, every per-item submission.
- **Architectural reuse**: no new orchestration paradigm; the module lives side-by-side with `01_05_agent` and reuses its domain / runtime / repository layers where possible.

### Non-Goals

- No new chat API, no HTTP surface toward end users. This is a CLI/one-shot job, though it runs inside the same runtime boot and uses the same repositories, events, providers, and tracing.
- No RL / gradient-based prompt search. The optimizer loop is deterministic and human-inspectable.
- No multi-task generalisation in v1 — the domain is categorize.
- Claude Opus is **advisor-only**; it does not execute verifier calls, does not count tokens, and does not manage state.
- **No agent-with-tool orchestration for Opus.** The task brief's hint ("Agent powinien mieć dostęp do narzędzia uruchamiającego pełen cykl…") suggests giving Opus a `run_full_cycle` tool that drives reset → CSV → 10 POSTs. This design deliberately **does not** do that. Reason: a deterministic Node.js orchestrator owning the loop gives us idempotent DB writes, replayable runs, exact budget guarantees, and a single source of truth for state transitions. Opus proposes prompt changes; code executes every hub call. If an agent-with-tool variant is desired later, it can be added as a separate entry-point that wraps the same hub client and repositories without displacing the deterministic runner.

---

## 2. Domain & Contracts

### 2.1 Allowed Output Alphabet

The rendered prompt MUST instruct the hub's tiny classifier to emit exactly one of `DNG` or `NEU`. The hub returns that classifier token (possibly wrapped) as the response for each POST. The client normalizes:

- Trim whitespace.
- Uppercase.
- Strip trailing punctuation and quoting.
- Strip any single surrounding XML tag (e.g. `<answer>DNG</answer>` → `DNG`).
- Anything else → `INVALID` (a parse failure that counts as a misclassification for the optimizer).

### 2.2 CSV Schema (input)

Downloaded from `https://hub.ag3nts.org/data/{API_KEY}/categorize.csv`. Shape (discovered at parse time, persisted verbatim):

| Column | Type | Role |
|---|---|---|
| `id` | string/int | stable item id — substituted into template as `{id}` |
| `description` | string | item description — substituted into template as `{description}` |
| any other columns | mixed | additional substitution variables, referenced in the template as `{column_name}` |

Placeholder names used in the template MUST match CSV column names. The downloader / parser MUST persist the raw bytes (hashed) and the parsed item list to DB.

**Client-side rendering**: the template carries `{column}` placeholders for readability and cache-impact analysis only. Before each POST the runner renders the template against one CSV row by substituting column values for their placeholders; the **rendered** string is what travels over the wire.

### 2.3 Hub Contract

**CSV download** (GET, one per attempt):
```
GET https://hub.ag3nts.org/data/{API_KEY}/categorize.csv
→ text/csv, 10 rows
```

**Verify** (POST, **one per item — 10 POSTs per attempt**):
```
POST https://hub.ag3nts.org/verify
Content-Type: application/json
{
  "apikey":  "<API_KEY>",
  "task":    "categorize",
  "answer":  { "prompt": "<RENDERED prompt for one CSV row>" }
}
```

For each of the 10 CSV rows we substitute the row's column values into the template and POST the resulting string. The hub runs its internal tiny classifier on that single rendered prompt and returns its result. Typical per-POST response (exact shape discovered at runtime, treated as opaque and structurally validated by a Zod parser):

| Field (typical) | Meaning |
|---|---|
| classifier output | raw text — should normalize to `DNG` or `NEU` |
| flag / `{FLG:...}` token | returned on the POST that completes all 10 correct classifications in an attempt |
| counter info | remaining attempts / remaining budget on the hub side, if exposed |
| error message | e.g. "incorrect classification for item 3", "budget exceeded" |

**Reset** (POST, special in-band payload):
```
POST https://hub.ag3nts.org/verify
{ "apikey": "...", "task": "categorize", "answer": { "prompt": "reset" } }
```
Clears the hub-side counter after misclassification or budget exhaustion so a new attempt can begin. A reset is counted as one submission (costed, tracked in budget).

**Constraints (per-POST)**:
- `tokenize(renderedPrompt) ≤ 100` — measured locally via `tiktoken` on the fully rendered string **for each item**. The candidate prompt-version is accepted only if `max_over_items(renderedPromptTokens_i) ≤ 100`.
- Template MUST reference only placeholders that correspond to actual CSV columns (statically verified before any dispatch).
- Rendered prompt MUST demand `DNG` or `NEU` as the hub-side classifier output (via the template's output contract line).

Failure modes:
- HTTP/network error per POST → bounded retry with backoff, then mark that per-item submission `error`.
- Response missing/malformed → mark submission `error(parse)`.
- Hub-reported misclassification → mark the offending per-item submission `ok(normalized, match=false)`; abort the remaining POSTs of this attempt; proceed to refinement.
- Hub-reported budget/counter exhaustion → send `reset` submission, open a new attempt (new iteration or retained prompt version — see §13).

### 2.4 Optimizer Contract (Claude Opus)

Input to Opus:
- Current prompt template (full text, with literal `{placeholder}` tokens intact).
- CSV schema (column list) + one representative CSV row (payload abbreviated).
- Summary of the last hub submission: success flag, raw response body, hub error text, per-item breakdown if surfaced.
- Token and budget context (`prefixTokens`, `worstItemTokens`, `worstTotal`, remaining budget, resets used).
- Constraint brief (≤ 100 tokens, allowed outputs `DNG`/`NEU`, placeholder-must-match-column rules, cache-friendly structure rules).

Output from Opus (structured JSON):
- `analysis`: short free-text reasoning about the observed failure.
- `proposal`: next template (full text, with `{placeholder}` tokens intact).
- `diff_summary`: short description of what changed vs previous.
- `expected_effect`: which failure modes this addresses.
- `cache_impact`: `none | prefix_preserved | prefix_mutated`.

Opus is **never** invoked mid-iteration for anything except refinement. All hub submissions and all token counting happen outside Opus.

---

## 3. Hard Constraints

- **Per-POST prompt budget**: `tokenize(renderedPrompt_i) ≤ 100` for every item `i` actually sent. A candidate prompt-version is accepted only if the worst-case rendered length across all 10 items passes. Candidates that exceed are rejected *before* any network call.
- **Total budget**: configurable USD ceiling for the whole run, covering all per-item hub POSTs, all resets, and all Opus calls. Hub POSTs may or may not surface token-level cost; default accounting uses a flat per-POST cost from config and is refined if the response surfaces real numbers.
- **Iteration cap**: configurable maximum number of prompt versions per run (default: 8). Orthogonal to the hub-side attempt counter.
- **Invariant preservation**: the static prefix contains *mandatory* domain invariants (see §7.4) that every accepted prompt version MUST retain. This is enforced as a regex/substring check against each accepted prefix and asserted in tests.
- **Determinism in orchestration**: no non-deterministic control flow — Opus proposes, code disposes.
- **Cache-friendliness**: the template has a stable static prefix (instructions + output contract + invariants); the placeholder-bearing item line sits at the tail. Across the 10 within-iteration POSTs the prefix is byte-identical, maximising cache warmth on the hub's underlying provider.
- **Placeholder contract**: the template references only `{column_name}` tokens that match CSV columns; every rendering is validated against the CSV before dispatch.
- **No external token-counter service**: token counting is strictly local via `tiktoken`.
- **No LLM tool for token counting**: tokenization is infrastructure, not a tool the LLM can call.

---

## 4. Architectural Alignment with `01_05_agent`

The categorize module lives as a new package (or sub-app) that imports from the same runtime primitives. Below is an explicit mapping.

| `01_05_agent` component | Strategy | Role in `categorize` |
|---|---|---|
| `src/lib/config.ts` (Zod env) | **Reuse + extend** | Adds categorize-specific env: `HUB_BASE_URL`, `HUB_API_KEY`, `CATEGORIZE_TASK_NAME`, `ANTHROPIC_API_KEY` (for Opus), `CATEGORIZE_BUDGET_USD`, `CATEGORIZE_MAX_ITERATIONS`, `CATEGORIZE_MAX_RESETS`, `CATEGORIZE_PER_POST_FLAT_COST_USD`, `CATEGORIZE_RESET_FLAT_COST_USD`, `CATEGORIZE_PROMPT_ENCODING`. |
| `src/lib/logger.ts` (Pino) | **Reuse as-is** | Same child-logger pattern per module. |
| `src/lib/tracing.ts` (Langfuse/OTel) | **Reuse as-is** | Same `traceAgent / traceGeneration / traceTool` helpers wrapping Opus calls and hub calls. |
| `src/lib/langfuse-subscriber.ts` | **Adapt** | Subscribe to new categorize events (`run.*`, `iteration.*`, `verify.*`, `refine.*`) in addition to existing `agent.*`. |
| `src/lib/event-logger.ts` | **Adapt** | Extend switch to handle new event types. |
| `src/events/types.ts` | **Extend** | Add new event variants for run/iteration/verify/refine. |
| `src/events/emitter.ts` | **Reuse as-is** | Same emitter pattern. |
| `src/runtime/context.ts` (`RuntimeContext` + `ExecutionContext`) | **Reuse + extend** | `RuntimeContext` gains a `categorize` facet: `{ hub, tokenizer, budget, optimizer }`. `ExecutionContext` gains `runId` and `iteration`. |
| `src/runtime/runner.ts` (agentic loop) | **Adapt conceptually, not reuse** | Categorize is not an open-ended agentic loop — it's a deterministic outer loop of iterations over a fixed input. We model it as an **Agent of task `categorize`** with a custom runner (`categorize/runner.ts`) that mirrors the state-machine discipline of `runner.ts` but replaces "turn = LLM call" with "iteration = batch of 10 verify calls + optional refinement". |
| `src/domain/agent.ts` state machine (`pending → running → waiting → completed/failed/cancelled`) | **Reuse pattern** | Each categorize run is backed by a `runs` row plus an `agents` row, reusing the same lifecycle transitions for orchestration status. |
| `src/domain/session.ts` | **Reuse + extend semantic** | One full attempt across 10 items is one session; resets/retries open a new session linked by `experimentLineageId`. |
| `src/domain/item.ts` (polymorphic conversation items) | **Keep for Opus conversations**; add new tables for categorize-specific entities | Items still store the Opus advisory conversation; categorize-specific data (CSV items, verify results, prompt versions) get first-class tables. |
| `src/repositories/sqlite/schema.ts` | **Extend** | Adds: `runs`, `csv_items`, `prompt_versions`, `hub_submissions`, `budget_usage`, `refinements`, `failure_analyses`. See DB_SCHEMA.md. |
| `src/repositories/sqlite/index.ts` | **Extend** | New repos for the new tables, same patterns (Drizzle, domain mappers). |
| `src/repositories/memory.ts` | **Extend** | Mirror the new repos for unit tests. |
| `src/providers/*` | **Reuse as-is** | Opus is exposed via the OpenAI-compatible adapter using OpenRouter (`anthropic/claude-opus-*`) or Anthropic SDK. Hub is NOT a provider (it's a domain-specific HTTP client). |
| `src/tools/*` (tool registry) | **Reuse as-is**, **do NOT** add a `count_tokens` tool | Tokenization stays as infrastructure. Opus gets no tools — it is invoked with plain prompts and structured output. |
| `src/mcp/*` | **Unused for categorize** | Categorize does not need MCP. |
| `src/workspace/loader.ts` (markdown agent templates) | **Reuse** | The Opus "prompt-engineer" instruction is stored as `workspace/agents/opus-prompt-engineer.agent.md`. |
| `src/db/seed.ts` | **Extend** | Adds default user for categorize runs. |
| `src/middleware/*`, `src/routes/*`, `src/errors/*` | **Reuse as-is if exposed as HTTP**, otherwise ignored | Categorize v1 ships as a CLI; an optional `POST /api/categorize/run` can be added later mirroring `POST /api/chat/completions`. |
| `drizzle` migrations | **Extend** | New migration adds categorize tables. |

### New modules required

- `src/categorize/runner.ts` — deterministic outer loop.
- `src/categorize/hub/client.ts` — HTTP client for hub (submit, reset).
- `src/categorize/hub/parser.ts` — response validation + flag extraction.
- `src/categorize/csv/downloader.ts` + `csv/parser.ts`.
- `src/categorize/prompt/builder.ts` + `prompt/renderer.ts` + `prompt/strategy.ts` + `prompt/validator.ts`.
- `src/categorize/tokens/estimator.ts` (tiktoken wrapper).
- `src/categorize/budget/tracker.ts`.
- `src/categorize/optimizer/opus-client.ts` (thin wrapper around provider registry).
- `src/categorize/optimizer/refiner.ts` (assembles Opus context, parses Opus output).
- `src/categorize/sessions/run-manager.ts`.
- `src/categorize/events.ts` — categorize-specific event variants + emitter subscription.
- `src/categorize/repositories/` — Drizzle repos for new tables.

---

## 5. Session Model

### 5.1 Definitions

- **Run** (new concept): a complete end-to-end attempt for the `categorize` task — from CSV download to final success/stop. One `runs` row.
- **Session** (reused from `01_05_agent`): one `sessions` row per run. If the hub demands a reset or we consciously restart, we open a **new session** with the same `experimentLineageId` so historical runs remain queryable together.
- **Agent** (reused): one root `agents` row per run representing the orchestrator instance. Child agents (if any are ever needed — e.g. a dedicated "opus-refiner" agent) are created via `parentId` exactly like `01_05_agent`'s delegate pattern.
- **Iteration** (a.k.a. "attempt"): one pass through the 10 items using a specific `prompt_versions.id`. An iteration dispatches up to 10 per-item POSTs in row order and aborts on the first misclassification/budget error. Many iterations per run.
- **Verification / submission**: one hub POST for one `(iteration, csv_item)` pair; persisted as a `hub_submissions` row with `kind='submit'`.
- **Reset**: one hub POST with `answer.prompt = "reset"`, persisted as a `hub_submissions` row with `kind='reset'` and `csv_item_id = NULL`.

### 5.2 Session Creation

1. `POST /api/categorize/run` (or CLI `categorize run`) → auth check → `sessionRepo.create(userId)` → `runRepo.create({ sessionId, experimentLineageId? })` → `agentRepo.create({ sessionId, task: 'categorize', config })`.
2. TraceId is generated once; stored on the `agents` row (same pattern as `01_05_agent`).
3. Initial `waitingFor: []`, status `pending`.

### 5.3 State Persistence

- All prompt candidates, all verify results, all refinements, all budget increments are appended to DB *before* any external call completes and mutated to final state on completion (write-ahead pattern, same discipline as `items` in `01_05_agent`).
- A crashed process can resume from the last persisted `runs.status` + last `prompt_versions` + last `hub_submissions`.
- `runs.status` follows: `pending → running → waiting → completed | failed | cancelled` (exact enum reuse from `agents`).

### 5.4 History Across Attempts

- `runs.experimentLineageId` (nullable) groups multiple retries of the same logical attempt. When the CLI is invoked with `--continue-lineage <id>`, the run copies prior lineage and can cross-reference earlier failures.
- Opus refinement context may include summaries of prior lineage runs (within budget) to avoid rediscovering known bad prompts.

---

## 6. Trace / Observability

All tracing passes through the existing Langfuse subscriber, extended for new event types. Each run produces a single Langfuse trace; each iteration a nested span; each verify a generation; each refinement a nested generation of its own.

### 6.1 New Events

```
run.started        { runId, sessionId, taskName, budget, limits }
run.completed      { runId, durationMs, finalStatus, flag, iterationsUsed, totalCostUsd, totalTokens }
run.failed         { runId, error, stopReason }

iteration.started  { iterationNo, promptVersionId, prefixTokens, worstItemTokens, cacheStrategy }
iteration.completed { iterationNo, correct, incorrect, invalid, errors, flag? }

verify.called      { iterationNo, promptVersionId, csvItemId, rowIndex, renderedTokens }
verify.completed   { iterationNo, promptVersionId, csvItemId, rowIndex, rawOutput, normalized, match?, durationMs, cost, flag? }
verify.failed      { iterationNo, promptVersionId, csvItemId, rowIndex, error, durationMs }

reset.performed    { iterationNo, reason }

refine.requested   { iterationNo, previousVersionId, failureCount }
refine.completed   { iterationNo, previousVersionId, newVersionId, analysis, diffSummary, opusCost, opusTokens }
refine.failed      { iterationNo, error }

budget.consumed    { scope: 'verify' | 'reset' | 'opus', usdDelta, tokenDelta, runningTotal }
budget.breached    { scope, limit, attemptedTotal }
```

All events share the existing `EventContext` (`traceId, sessionId, agentId, rootAgentId, depth, timestamp`) extended with `runId` and `iterationNo`.

### 6.2 Langfuse Mapping

- `run.started` → top-level trace + agent observation (`traceAgent('categorize', {...})`).
- `iteration.started/completed` → nested span of type `span` (groups the 10 per-item generations).
- `verify.completed` → `traceGeneration` with `model = hub:categorize`, input = the rendered prompt sent, output = raw hub response, usage reported if the hub provides it.
- `refine.completed` → `traceGeneration` with `model = anthropic:claude-opus-*`, input = advisor context, output = proposal, usage from Anthropic response.
- `reset.performed` → `traceGeneration` with `model = hub:categorize` and input `{prompt: "reset"}`, tagged `isReset=true` in metadata.
- `budget.*` → Langfuse trace metadata updates on cumulative totals.

### 6.3 Replay Guarantee

Given only the DB and trace, we can reconstruct:
- the exact CSV downloaded (raw bytes, hash);
- every prompt version attempted, with token estimates (prefix, per-item, worst-case) and mutation class;
- every per-item hub submission (rendered prompt sent, raw response, normalized classification, match flag, costs);
- every reset event and its preceding context;
- every Opus advisory prompt, response, and rationale;
- cumulative budget and remaining budget at every point;
- the exact reason the run stopped.

---

## 7. Prompt Strategy (no final prompt — only discipline)

### 7.1 Structural Contract

Every prompt template is composed as:

```
[STATIC PREFIX]                  ← cacheable, identical across all 10 within-iteration POSTs
  - classification task statement
  - domain invariants (see §7.4)
[OUTPUT CONTRACT LINE]           ← "Odpowiedz DNG lub NEU."
[PLACEHOLDER ITEM LINE]          ← tail — e.g. "ID {id}: {description}"
```

Before each POST the runner renders the placeholder line against one CSV row; the static prefix is byte-identical across the 10 within-iteration POSTs so the hub's underlying provider can cache-hit on rows 2..10.

### 7.2 Design Rules

- **Language**: the item descriptions arrive in Polish, so the prompt is naturally Polish-leaning. The English hint from the task brief is allowed — the only constraint is that the hub's tiny classifier must understand it. In practice: keep instructions terse and unambiguous in whichever language the smallest prefix lands in.
- **Single-letter codes** for output (`DNG`, `NEU`) — mandated, also reinforces compression.
- **Zero stylistic fluff**: no pleasantries, no "please", no "you are a helpful".
- **No CoT request**: small models often hallucinate reasoning and drift from the format.
- **Imperative + contract**: state the rule, state the invariants, then the rendered item line, then demand the answer.
- **No variable decorators**: avoid timestamps, version strings, or run IDs anywhere in the template — these kill cache.
- **Exception clauses are first-class**: domain-specific overrides (e.g. reactor parts) live in the static prefix, not added ad-hoc.
- **Minimal mutation between versions**: when Opus proposes a refinement, prefer edits to the *end* of the static block or to the output-contract line over surgery in the middle. Cache impact is declared explicitly in the Opus response.

### 7.3 Evaluation Criteria for a Prompt Candidate

Each candidate is scored before it ever sees network traffic:

1. `max_i tokenize(renderedPrompt_i) ≤ 100` across all 10 CSV rows — hard gate.
2. All placeholders in the template ⊆ CSV columns — hard gate.
3. Required invariants (see §7.4) are present in the prefix — hard gate.
4. `output determinism` — the contract line must specify exactly `DNG` or `NEU`, nothing else.
5. `cache reuse` — fraction of the prefix preserved vs previous version (computed as longest common prefix ratio; mutation class A/B/C/D).
6. `error resistance` — did the previous attempt return any `INVALID` classifications or misclassifications? If yes, Opus should address those first.

The selection heuristic for "is this version good enough to run":
- hard gates #1, #2, #3 must pass;
- among passing candidates, prefer the one with the highest cache reuse given equal expected clarity.

### 7.4 Required Invariants

Every accepted prompt-version's static prefix MUST contain, at minimum, the following invariants. They are enforced mechanically (regex/substring check) by `prompt/validator.ts` and asserted in regression tests.

| ID | Invariant | Rationale |
|---|---|---|
| `INV-OUTPUT` | The prefix (or contract line) instructs the classifier to answer with exactly `DNG` or `NEU`, no other text. | Task-defined output alphabet. |
| `INV-REACTOR-NEU` | The prefix states that **parts / components destined for a reactor are always NEU, even if the description sounds alarming** (uses the noun stem `reaktor` / `reactor`). | Task brief explicit exception; the tiny model is prone to classifying alarming-sounding reactor parts as DNG otherwise. |

Adding new invariants in the future is a deliberate act: they go into this table, into the validator, into the regression test, and into the Opus advisor brief as "must-preserve" clauses. Opus's advisor template lists them so every refinement proposal retains them.

If Opus's proposal strips an invariant, the validator rejects the proposal with `reject_reason='invariant_removed'` and the orchestrator either runs the deterministic shrinker or re-prompts Opus with a corrective instruction naming the missing invariant.

---

## 8. Cache Strategy

### 8.1 Principles

- Prefix is the cache key. Treat it as near-immutable.
- Dynamic data lives at the tail.
- Between iterations, **mutate the smallest possible region**.
- No time, no nonce, no random bits anywhere in the prompt.
- Temperature = 0 on verifier (if exposed by hub), to make hits maximally valuable.

### 8.2 Mutation Policy

Mutations are classified:

| Class | What changed | Cache impact | Allowed? |
|---|---|---|---|
| A | Item tail only | Cache fully preserved | Always |
| B | Output-contract line only | Partial prefix still cached by many providers | Preferred for minor format fixes |
| C | Last sentence of static prefix | Partial cache loss | Allowed if B insufficient |
| D | Middle or front of static prefix | Cache fully invalidated | Only if a systemic failure demands it and Opus flags it as `prefix_mutated` |

Opus MUST declare the expected class of its proposed change (`cache_impact` field). Orchestrator logs this into `refinements.cache_impact` and enforces soft preferences.

### 8.3 Versioning

- `prompt_versions.id` is a monotonic integer per run, plus a content hash.
- Two versions with identical normalized prefix share a `prefix_hash` — this is the unit the cost model treats as "cache-warm".
- Within a single iteration the orchestrator issues all 10 per-item POSTs **back-to-back**, in row order, with the same prefix. This is the primary cache-warmth window (rows 2..10 hit the provider's cache over row 1).

### 8.4 Cost-Aware Experimentation

Before starting iteration N:
- estimate `10 × perPostCostUsd + resetCostUsd(ifNeeded)` for the upcoming attempt;
- add expected Opus cost if refinement will follow;
- compare with remaining budget;
- if proceeding would breach the budget, stop and return best-so-far.

### 8.5 Hub-side Cache

Caching efficiency on the hub's tiny model depends on whether its underlying provider caches across our back-to-back per-item POSTs. The only knob we control is: **keep the prefix byte-identical across all 10 POSTs of an iteration, and across consecutive iterations**. A `reset` submission is assumed to invalidate hub-side cache, so it is used sparingly and only when the hub-side counter forces it.

---

## 9. Token Estimation Strategy

### 9.1 Module Responsibilities

`src/categorize/tokens/estimator.ts` owns:
- lazy-initializing a `tiktoken` encoder;
- `estimateText(text: string): number` — generic counter;
- `estimateRendered(prefix: string, contract: string, renderedTail: string): number` — tokenizes the exact string that will travel over the wire for one item;
- `estimateWorstCase(template: PromptTemplate, csvItems: CsvItem[]): { prefixTokens, perItemTokens: number[], worstItemTokens, worstTotal }` — tokenizes every one of the 10 per-item renderings;
- warning if `worstTotal > 100` — callers MUST treat this as a hard rejection.

### 9.2 Encoding Choice

- Default encoder: `cl100k_base` (OpenAI-compatible; a conservative cross-model approximation).
- Configurable via `CATEGORIZE_PROMPT_ENCODING` env to switch to `o200k_base` if the hub's tiny model is known to use a newer tokenizer.
- The chosen encoding is recorded per `prompt_versions` row so historical token counts remain interpretable.

### 9.3 Fallbacks

- If `tiktoken` fails to initialize (native bindings), fall back to the existing character-based heuristic in `src/utils/tokens.ts` (`~3.5 chars/token`) but mark the `prompt_versions.token_method = 'heuristic'`.
- A run that operated in heuristic mode cannot "prove" its 100-token compliance; it logs a warning and continues only in dev, fails hard in production (`NODE_ENV=production`).

### 9.4 Use Sites

1. Prompt candidate creation — reject if `worstTotal > 100` (computed against the 10 real CSV rows for this run).
2. Per-POST last-chance gate — `estimateRendered` is computed once per item just before dispatch; if it exceeds 100 the specific per-item submission is rejected (`error='item_token_overflow'`), which is nearly impossible given the §9 candidate gate but guards against late CSV surprises on resume.
3. Pre-send budget estimation — expected cost computation.
4. Post-send calibration — compare local per-item estimate vs hub-reported input tokens (if available) to calibrate estimator drift.
5. Refinement context — Opus receives `prefixTokens`, `worstItemTokens`, `worstTotal` and `maxAllowed=100` as hard facts, not as a tool call.

### 9.5 What Opus is NOT Allowed to Do

- Invoke `count_tokens` as a function call.
- Invoke the verifier or the tokenizer.
- Access any MCP tools, web search, or external services.

Opus sees only text. Opus emits only text (JSON-structured). Counting happens in code.

---

## 10. Claude Opus Refinement Strategy

### 10.1 When to Invoke Opus

Opus is called between iterations only if:
- at least one item in the last iteration was `incorrect` or `INVALID`;
- the remaining budget allows an Opus call;
- iteration count < `CATEGORIZE_MAX_ITERATIONS`;
- this iteration did not already produce a correct-all result.

### 10.2 Opus Input (constructed in code)

A single user message containing:
1. **Task brief** (static — read from `workspace/agents/opus-prompt-engineer.agent.md`): role definition, output format, hard constraints (`≤100 tokens` on every *rendered* per-item prompt, output alphabet `DNG`/`NEU`, placeholder rules, required invariants from §7.4, cache discipline).
2. **CSV schema**: the list of columns available as placeholders (e.g. `{id}`, `{description}`).
3. **A few representative CSV rows** (up to 3): the shortest, the longest, and a median one — so Opus can reason about the worst-case token envelope of its proposed rendering.
4. **Current candidate** template verbatim, with `prefixTokens`, `worstItemTokens`, `worstTotal`.
5. **Failure digest**: the last attempt's per-item raw outputs, normalized classifications, which rows were misclassified, the hub's error message, and any hub counter info.
6. **Budget snapshot**: `{ usdRemaining, iterationsRemaining, resetsUsed }`.
7. **Cache rules**: the mutation-class table.
8. **Required invariants** (from §7.4): listed explicitly with the instruction "your proposal MUST preserve every listed invariant verbatim or by clear paraphrase; if you remove one, your proposal will be rejected".
9. **Previous refinements** (optional, budget-permitting): last 1–2 `analysis + diff_summary` entries so Opus doesn't loop.

### 10.3 Opus Output (structured)

Opus is requested to return JSON:

```json
{
  "analysis": "string — 1-3 sentences",
  "proposal": "string — full new prompt text (prefix + output contract; item placeholder marked)",
  "diff_summary": "string — what changed vs previous",
  "expected_effect": "string",
  "cache_impact": "none | prefix_preserved | prefix_mutated",
  "estimated_tokens_hint": "number (advisory; authoritative count comes from tiktoken)"
}
```

If Opus returns malformed JSON: one retry with a terse correction message; second failure → mark `refinements.status='failed'`, fall back to deterministic shrinker (see §10.5) or stop.

### 10.4 Safety Rails Around Opus

- **No tool access**. Opus is a pure text-in, text-out generator.
- **No orchestration power**. Its `proposal` is a *candidate* — the orchestrator independently runs `tokenize → gate → persist → dispatch`.
- **Temperature ≤ 0.3** for determinism.
- **Strict max output tokens** for the Opus call (e.g., 1000) to bound cost.
- **Rate limited**: at most one Opus call per iteration boundary.

### 10.5 Deterministic Fallback Shrinker

If Opus is unavailable or the run is over budget for Opus but still has verifier budget:
- Apply rule-based shrinkers: strip adjectives/determiners, replace phrases with shorter synonyms from a curated table, remove redundant whitespace.
- This cannot invent new strategies, but can salvage an over-budget candidate into compliance.

---

## 11. File / Module Structure

Extending `01_05_agent` structure in-place (or, equivalently, as a sibling package that imports from it):

```
src/
  index.ts                       # [reuse] existing entry (extended to optionally boot categorize CLI)
  examples.ts                    # [reuse]

  lib/
    app.ts                       # [reuse] existing Hono app
    config.ts                    # [extend] new env vars for hub/opus/budget
    logger.ts                    # [reuse]
    runtime.ts                   # [extend] init categorize facet in RuntimeContext
    tracing.ts                   # [reuse]
    event-logger.ts              # [extend] handle new event types
    langfuse-subscriber.ts       # [extend] subscribe new events

  events/
    emitter.ts                   # [reuse]
    index.ts                     # [reuse]
    types.ts                     # [extend] new event variants

  domain/
    agent.ts                     # [reuse]
    item.ts                      # [reuse]
    session.ts                   # [reuse]
    types.ts                     # [extend] + RunId, IterationNo, PromptVersionId
    user.ts                      # [reuse]
    categorize/                  # NEW
      run.ts                     # Run entity + transitions
      prompt-version.ts          # PromptVersion entity
      hub-submission.ts          # HubSubmission entity (per-item submit + reset rows)
      refinement.ts              # Refinement entity
      csv-item.ts                # CsvItem entity
      budget.ts                  # Budget entity + arithmetic

  runtime/
    context.ts                   # [extend] RuntimeContext gains categorize: { hub, tokenizer, budget, optimizer }
    runner.ts                    # [reuse] for chat agents
    index.ts                     # [reuse]

  providers/                     # [reuse]
    openai/, gemini/, registry.ts, types.ts
                                 # Opus usage: register an Anthropic/OpenRouter provider key in lib/runtime.ts

  tools/                         # [reuse]  — no new tools for categorize

  mcp/                           # [reuse]  — unused by categorize

  repositories/
    types.ts                     # [extend] add CategorizeRepositories
    memory.ts                    # [extend] in-memory for tests
    sqlite/
      schema.ts                  # [extend] new tables: runs, csv_items, prompt_versions, hub_submissions, refinements, failure_analyses, budget_usage
      index.ts                   # [extend] new repos following same patterns

  db/
    setup.ts                     # [reuse]
    seed.ts                      # [extend] seed user + example run config

  categorize/                    # NEW top-level module
    index.ts                     # public entry (startRun, resumeRun)
    runner.ts                    # deterministic outer loop
    events.ts                    # event helpers specific to categorize
    sessions/
      run-manager.ts             # create/resume run, persist state transitions
    csv/
      downloader.ts              # fetch CSV from hub, persist raw bytes + hash
      parser.ts                  # row → CsvItem[]; extract column list
    hub/
      client.ts                  # POST /verify — one POST per item + reset submissions
      parser.ts                  # response schema validation, flag extraction, error surface
      normalize.ts               # raw classifier output → DNG|NEU|INVALID
    prompt/
      builder.ts                 # assemble prefix + contract + placeholder-line → template
      renderer.ts                # render(template, csvRow) → concrete prompt string
      strategy.ts                # versioning, mutation classification, prefix hashing
      validator.ts               # placeholders ⊆ CSV columns; required invariants; worst-case token gate
    tokens/
      estimator.ts               # tiktoken wrapper, tokenization policy
    budget/
      tracker.ts                 # USD + tokens + iteration counters, breach detection
    optimizer/
      opus-client.ts             # calls provider registry with Opus model id
      refiner.ts                 # build context, parse JSON response, fallback shrinker
      parser.ts                  # strict JSON validation (zod)

  workspace/
    agents/
      alice.agent.md             # [reuse]
      bob.agent.md               # [reuse]
      opus-prompt-engineer.agent.md   # NEW — static instruction for Opus (includes required invariants from §7.4)
    prompts/
      categorize/
        base.prefix.md           # NEW — seed static prefix text (must include INV-OUTPUT and INV-REACTOR-NEU)

  errors/, middleware/, routes/  # [reuse]; optional new route /api/categorize/run

docs/
  SPEC.md                        # (this file)
  ARCHITECTURE.md
  DB_SCHEMA.md
  EXECUTION_FLOW.md

tests/
  categorize/
    tokens.spec.ts               # tiktoken estimates; worst-case calculations across 10 items
    prompt-builder.spec.ts       # structural guarantees (prefix/contract/placeholder line)
    prompt-renderer.spec.ts      # placeholder substitution; {col} → csv[col]; missing col surfaces
    prompt-validator.spec.ts     # placeholders ⊆ columns, worst-case token gate, invariants present
    invariants.spec.ts           # INV-OUTPUT and INV-REACTOR-NEU detection regex tests
    normalize.spec.ts            # DNG|NEU|INVALID normalization
    hub-client.mocked.spec.ts    # mocked /verify: per-item DNG/NEU, flag-on-10th, error, reset
    hub-parser.spec.ts           # flag extraction, misclassification error messages, counter surface
    refiner.spec.ts              # Opus JSON parsing, invariant-preservation check, shrinker fallback
    run-manager.spec.ts          # lifecycle persistence, reset handling, per-item fan-out resume
    repositories.spec.ts         # SQLite + in-memory parity
    trace.spec.ts                # event coverage for a run
    regression/
      prompt-versions.spec.ts    # snapshot tests over known versions (asserts invariants present)
```

---

## 12. Test Plan

### 12.1 Unit Tests

- **Token estimation** (`tokens.spec.ts`):
  - known fixtures produce expected token counts within ±1 vs `tiktoken` reference;
  - heuristic fallback never under-estimates for typical Polish inputs;
  - `estimateWorstCase` correctly reports the longest-item rendering across 10 CSV rows;
  - exceeds-100 worst-case renderings are rejected by the gate.
- **Prompt builder** (`prompt-builder.spec.ts`):
  - output always has `prefix + contract + placeholder-line` structure;
  - no dynamic noise (timestamps, random) present in the template;
  - `prefix_hash` is stable.
- **Prompt renderer** (`prompt-renderer.spec.ts`):
  - `{id}` substituted by `csv[id]` verbatim; likewise all other columns;
  - missing column throws (should never hit this after validator);
  - rendered string does not contain any stray `{col}` token.
- **Prompt validator** (`prompt-validator.spec.ts`):
  - unknown placeholder → rejection with `unknown_placeholder`;
  - missing required invariant → rejection with `invariant_removed` (lists the missing invariant id);
  - worst-case rendering > 100 → rejection with `exceeds_100_tokens`;
  - all gates pass → accepted.
- **Invariants** (`invariants.spec.ts`):
  - `INV-OUTPUT` detection regex matches "DNG lub NEU", "DNG or NEU", "Odpowiedz DNG|NEU" style phrasings;
  - `INV-REACTOR-NEU` detection regex matches Polish/English noun stems `reaktor`/`reactor` combined with `NEU`/`neutraln*`.
- **Normalize** (`normalize.spec.ts`):
  - `'DNG'`, `' dng\n'`, `'<answer>DNG</answer>'`, `'"NEU"'` all map to expected class;
  - ambiguous outputs → `INVALID`.
- **Budget tracker**:
  - accumulation, breach detection, serialization to DB.
- **Mutation classifier**:
  - Class A/B/C/D classification from before/after prefixes.

### 12.2 Mocked Hub Tests

Mock `hub-client` returning scripted per-POST responses. Scenarios:
- **All-correct happy path**: 10 POSTs return `DNG`/`NEU` per expected; 10th response carries the flag.
- **Early misclassification**: POST 4 returns wrong class + hub error; remaining POSTs are aborted; runner triggers refine.
- **Budget exhaustion mid-stream**: POST 7 returns counter-exhausted; runner triggers reset + refine.
- **Reset cycle**: preceding attempt ended in error → reset POST → fresh attempt reloads CSV (or reuses) → 10 POSTs.
- **Network transient**: POST 3 returns HTTP 503 twice then succeeds (tests retry/backoff).
- **Parse failure**: hub returns garbage → normalize → `INVALID` → treated as misclassification.

Each scenario drives `runner.ts` end-to-end and asserts correct persistence, events, budget increments, state transitions, and reset lifecycle.

### 12.3 Prompt Version Regression

- Snapshot known prompt version strings + their `tiktoken` counts.
- Any change to `prompt/builder.ts` must intentionally update snapshots, preventing silent prefix drift that kills cache.

### 12.4 DB Persistence Tests

- Round-trip every entity (in-memory and SQLite).
- `runs` state machine transitions rejected illegally (`completed → running` forbidden).
- Concurrent `hub_submissions` writes for the same `(runId, promptVersionId, csvItemId, kind='submit')` are idempotent. Resume reuses any existing `pending` row; terminal rows are never re-issued.

### 12.5 Trace Completeness

- Replay subscriber in-process; assert every `run.started` has a matching `run.completed/failed`;
- every `iteration.started` has between 1 and 10 `verify.completed|failed` events (≤10 because the loop aborts on first misclassification), matched by exactly one `iteration.completed`;
- every `refine.requested` has a terminal `refine.completed/failed`;
- no dangling spans after the run ends.

### 12.6 End-to-End (Optional, Behind Env Flag)

- Against a staging hub endpoint: run one full categorize session; assert either success within budget or documented stop condition.
- Opus call is mocked unless `CATEGORIZE_E2E_REAL_OPUS=1`.

---

## 13. Stop Conditions

A run terminates (orchestrator decides — Opus has no authority here):

| Condition | Final status | Notes |
|---|---|---|
| Any per-item response contains the `{FLG:...}` flag | `completed` | Record prompt version as `winning_version_id`; persist flag in `runs.flag` and `runs.result`. |
| Iterations ≥ `CATEGORIZE_MAX_ITERATIONS` without obtaining the flag | `failed` (`reason='iteration_cap'`) | Best-scoring version recorded. |
| Budget breach (USD) with no room for another attempt (10 POSTs + optional reset + optional Opus) | `failed` (`reason='budget'`) | Partial results preserved. |
| Hub-side counter exhausted AND `CATEGORIZE_MAX_RESETS` reached | `failed` (`reason='resets_exhausted'`) | All submissions preserved. |
| Deterministic shrinker cannot produce a ≤100-token worst-case rendering | `failed` (`reason='compression'`) | Last over-budget candidate preserved. |
| Hub returns persistent 5xx beyond retry policy | `failed` (`reason='hub_unavailable'`) | |
| All accepted prompts strip a required invariant (validator keeps rejecting) | `failed` (`reason='invariant_unrecoverable'`) | Should not normally happen; indicates Opus + shrinker both broken. |
| Operator cancels (SIGINT) | `cancelled` | Same graceful shutdown as `01_05_agent`. |

---

## 14. Security & Configuration

- All secrets via env (`HUB_API_KEY`, `ANTHROPIC_API_KEY`/`OPENROUTER_API_KEY`, `LANGFUSE_*`) — Zod-validated in `lib/config.ts`.
- Hub responses are treated as untrusted text; normalized through a strict parser before hitting any downstream logic.
- DB path writable only by the process user; WAL mode + busy_timeout reused from `01_05_agent`.
- Rate limiter (reused from `01_05_agent` middleware) protects any exposed HTTP surface.

---

## 15. Open Questions for Implementation

Documented for traceability; not blocking this spec:

1. Does the hub response per POST include usage numbers (`input_tokens`, `cached_tokens`)? If yes, the estimator gets a calibration signal for each item. If no, we rely on local `tiktoken` and a flat per-POST cost model.
2. Does the hub fail-fast on first misclassification (abort remaining POSTs of an attempt server-side) or does it keep accepting submissions until all 10 have been sent? The runner assumes fail-fast and cancels remaining POSTs on first error; if the hub differs, we only lose the optional insight from the skipped POSTs.
3. On which POST does the flag arrive — the 10th, or a dedicated final "finalize" call? We assume it rides with the 10th per-item response; the parser accepts it on any response defensively.
4. Exact tokenizer used by the hub's tiny model — assume `cl100k_base` until told otherwise; record assumption in `prompt_versions.encoding`.
5. Exact semantics of the hub-side counter — does it count per-POST or per-attempt? Controls when `reset` is invoked.

---

## 16. Deliverables for This Step

This spec is one of four documents requested:

- **SPEC.md** — this file.
- **ARCHITECTURE.md** — component diagrams + responsibility matrix.
- **DB_SCHEMA.md** — Drizzle schema definitions + migration plan.
- **EXECUTION_FLOW.md** — step-by-step runbook of a single run.
