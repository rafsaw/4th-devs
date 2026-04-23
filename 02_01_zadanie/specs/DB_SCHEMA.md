# DB_SCHEMA — `categorize` Exercise

> Persistence model. Extends `01_05_agent`'s existing SQLite schema (`users`, `sessions`, `agents`, `items`) with 7 new tables. Same discipline as the existing schema: Drizzle ORM, libsql driver, WAL mode, explicit indexes, integer timestamps, JSON columns for structured payloads.

> Note: the hub evaluates one **rendered** prompt per POST. One iteration = one prompt version = up to **10 per-item `hub_submissions` rows** (one per CSV item, plus optional reset submissions). Aborted attempts simply have fewer submit rows than 10.

---

## 1. Design Principles

- **Write-ahead**: every row representing an external call starts `pending` and is updated to its terminal state after the I/O completes. A crashed process leaves a recoverable trail.
- **Append-only audit logs** where possible (`budget_usage`) so cost reconstruction is always exact.
- **Monotonic integer sequences** for human-readable iteration numbers (`iteration_no`) alongside UUID primary keys.
- **Explicit indexes** on all query hot paths (by run, by iteration, by item).
- **Domain parity**: every table has a matching domain entity in `src/domain/categorize/*.ts` with pure mappers in `src/repositories/sqlite/index.ts`, mirroring the existing `toUser / toSession / toAgent / toItem` pattern.
- **FK with no cascade** (same convention as existing schema) — deletes are intentionally restrictive.

---

## 2. Schema Overview (ER summary)

```
users (existing)
  └─ sessions (existing, + new column: experiment_lineage_id)
       └─ agents (existing)
       └─ runs (NEW)
             ├─ csv_items (NEW)          — inputs (10 per run)
             ├─ prompt_versions (NEW)    — prompt templates tried
             │     └─ hub_submissions (NEW) — per-item POSTs (up to 10 per version) + reset POSTs
             ├─ refinements (NEW)        — Opus advisor turns
             ├─ failure_analyses (NEW)   — summarized failure digests
             └─ budget_usage (NEW)       — append-only cost ledger
```

`items` (existing polymorphic) remains available for recording the Opus advisory conversation as structured turns if useful for debugging; not required.

---

## 3. Modifications to Existing Tables

### 3.1 `sessions` — add `experiment_lineage_id`

```
sessions
  ...                                (unchanged)
  experiment_lineage_id TEXT NULL    (NEW — groups retries of the same logical attempt)
```

Index added:

```
CREATE INDEX sessions_lineage_idx ON sessions (experiment_lineage_id)
```

Drizzle addition:

```ts
experimentLineageId: text('experiment_lineage_id'),
```

Nullable because most sessions (chat agents) are not categorize runs.

### 3.2 `agents`, `items`, `users` — unchanged

No modifications. The root categorize orchestrator is an `agents` row with `task = 'categorize'` and `config.model = '<advisor model only, informational>'`.

---

## 4. New Tables (definitions)

Drizzle style, mirroring `01_05_agent/src/repositories/sqlite/schema.ts`. Types shown in Drizzle + SQL.

---

### 4.1 `runs`

One row per full attempt.

```ts
export const runs = sqliteTable('runs', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id),
  rootAgentId: text('root_agent_id').notNull().references(() => agents.id),
  userId: text('user_id').notNull().references(() => users.id),

  // Task
  taskName: text('task_name').notNull(),           // e.g. "categories"
  hubBaseUrl: text('hub_base_url').notNull(),
  experimentLineageId: text('experiment_lineage_id'),

  // CSV snapshot
  csvSha256: text('csv_sha256'),                   // hash of downloaded bytes
  csvRaw: text('csv_raw'),                         // full raw text (small — 10 rows)
  csvColumns: text('csv_columns', { mode: 'json' }).$type<string[]>(),  // discovered column names
  csvDownloadedAt: integer('csv_downloaded_at', { mode: 'timestamp' }),

  // Limits (copied from config at start for auditability)
  limitsJson: text('limits_json', { mode: 'json' }).notNull().$type<{
    maxIterations: number
    maxResets: number
    budgetUsd: number
    perPostFlatCostUsd: number
    resetFlatCostUsd: number
    promptEncoding: string
    opusModel: string
  }>(),

  // Lifecycle
  status: text('status', {
    enum: ['pending', 'running', 'waiting', 'completed', 'failed', 'cancelled']
  }).notNull().default('pending'),
  stopReason: text('stop_reason'),                 // e.g. 'success', 'iteration_cap', 'budget', 'compression', 'hub_unavailable', 'resets_exhausted', 'csv_shape'
  winningVersionId: text('winning_version_id'),    // FK-like, soft reference to prompt_versions.id
  flag: text('flag'),                              // the {FLG:...} returned by the hub on success
  iterationsUsed: integer('iterations_used').notNull().default(0),
  resetsUsed: integer('resets_used').notNull().default(0),
  totalCostUsdMillis: integer('total_cost_usd_millis').notNull().default(0),   // integer millicents
  totalInputTokens: integer('total_input_tokens').notNull().default(0),
  totalOutputTokens: integer('total_output_tokens').notNull().default(0),

  error: text('error'),
  result: text('result', { mode: 'json' }),        // final summary payload (including flag, best version ref)

  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  startedAt: integer('started_at', { mode: 'timestamp' }),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
}, (t) => [
  index('runs_session_idx').on(t.sessionId),
  index('runs_status_idx').on(t.status),
  index('runs_lineage_idx').on(t.experimentLineageId),
])
```

**Purpose**: the top-level record of one attempt. Holds the exact inputs and outputs so any run is fully reconstructable.

**Key fields explained**:
- `csvSha256` + `csvRaw`: snapshot the exact input. If the hub returns a new CSV next time, we can still re-evaluate an old run.
- `limitsJson`: freezes config at start — even if env changes, the run is interpretable later.
- `stopReason` vs `status`: `status` is the state-machine state; `stopReason` is the classification (for dashboards).
- `totalCostUsd_millis`: integer millicents to avoid floating-point drift; display code divides by 100_000.

---

### 4.2 `csv_items`

One row per CSV input item (always 10 per run).

```ts
export const csvItems = sqliteTable('csv_items', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => runs.id),
  rowIndex: integer('row_index').notNull(),         // 0..9 (stable within a run)
  externalId: text('external_id'),                  // CSV id column if present
  payload: text('payload', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (t) => [
  index('csv_items_run_idx').on(t.runId),
  uniqueIndex('csv_items_run_row_uq').on(t.runId, t.rowIndex),
])
```

**Purpose**: persist the exact items the hub will classify in this run.

**Why it matters**:
- `payload` is a JSON object keyed by CSV column name; this is the authoritative form used (a) to validate that every placeholder in a template has a matching column, (b) as the substitution source when the runner renders the template per item, (c) to send sample rows to Opus during refinement, (d) for manual replay of a single item against a prompt.
- We do not pre-render prompts here; rendering happens just-in-time in `prompt/renderer.ts`. The `renderedPrompt` string actually sent for each item is stored on the corresponding `hub_submissions` row.

---

### 4.3 `prompt_versions`

One row per prompt template considered in a run.

```ts
export const promptVersions = sqliteTable('prompt_versions', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => runs.id),
  iterationNo: integer('iteration_no').notNull(),    // monotonic 1..N within run
  parentVersionId: text('parent_version_id'),        // previous candidate, if this was a refinement
  refinementId: text('refinement_id'),               // set if generated by Opus; null for v1

  // Template body (stored as 3 segments for cache-diff analysis)
  prefix: text('prefix').notNull(),                  // static part (cacheable; must contain required invariants — see SPEC §7.4)
  outputContract: text('output_contract').notNull(), // e.g. "Odpowiedz DNG lub NEU."
  placeholderLine: text('placeholder_line').notNull(), // e.g. "ID {id}: {description}"
  templateFull: text('template_full').notNull(),     // prefix + contract + placeholderLine (with literal {placeholders})

  // Placeholders referenced (validation metadata)
  placeholders: text('placeholders', { mode: 'json' }).notNull().$type<string[]>(),

  // Invariants detected in the prefix (SPEC §7.4) — stored for audit
  invariantsPresent: text('invariants_present', { mode: 'json' }).notNull().$type<string[]>(),

  // Hashes for cache reasoning
  prefixHash: text('prefix_hash').notNull(),
  contentHash: text('content_hash').notNull(),

  // Token budget
  encoding: text('encoding').notNull(),              // e.g. 'cl100k_base'
  tokenMethod: text('token_method', { enum: ['tiktoken', 'heuristic'] }).notNull(),
  prefixTokens: integer('prefix_tokens').notNull(),         // tokens of the static prefix alone
  worstItemTokens: integer('worst_item_tokens').notNull(),  // max_i tokenize(renderedTail_i) across 10 CSV rows
  worstTotalTokens: integer('worst_total_tokens').notNull(),// prefix + contract + worst-item — authoritative gate (≤ 100)
  perItemTokensJson: text('per_item_tokens_json', { mode: 'json' }).$type<number[]>(),  // tokens of each renderedTail_i

  // Cache classification vs parent
  mutationClass: text('mutation_class', { enum: ['A', 'B', 'C', 'D', 'none'] }).notNull().default('none'),
  prefixReuseRatio: integer('prefix_reuse_ratio_bp'),  // basis points 0..10000 vs parent prefix

  // Gate decision
  status: text('status', { enum: ['accepted', 'rejected', 'winning'] }).notNull().default('accepted'),
  rejectReason: text('reject_reason'),                 // 'exceeds_100_tokens' | 'unknown_placeholder' | 'invariant_removed' | 'parse_failed' | ...

  // Result summary (derived from hub_submissions of this version)
  firstDispatchedAt: integer('first_dispatched_at', { mode: 'timestamp' }),
  submitsMade: integer('submits_made').notNull().default(0),          // 0..10
  correctCount: integer('correct_count').notNull().default(0),
  incorrectCount: integer('incorrect_count').notNull().default(0),
  invalidCount: integer('invalid_count').notNull().default(0),
  flagObtained: integer('flag_obtained', { mode: 'boolean' }).notNull().default(false),

  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (t) => [
  index('pv_run_idx').on(t.runId),
  uniqueIndex('pv_run_iter_uq').on(t.runId, t.iterationNo),
  uniqueIndex('pv_run_content_uq').on(t.runId, t.contentHash),
  index('pv_prefix_hash_idx').on(t.prefixHash),
])
```

**Purpose**: the historical record of every template tried, whether it was dispatched, and — rolled up from its per-item `hub_submissions` — how it performed.

**Key fields**:
- `prefix`, `outputContract`, `placeholderLine` stored separately so cache impact can be analyzed by diffing the appropriate segment.
- `templateFull` is the canonical template string (with placeholders still literal) — authoritative for replay; actual rendered strings per item live on `hub_submissions`.
- `placeholders` enumerates the `{col}` tokens present, making "was this template valid against that CSV?" a single-column query.
- `invariantsPresent` records which required invariants (e.g. `INV-OUTPUT`, `INV-REACTOR-NEU`) were detected. The validator asserts this list equals the required set before acceptance; regression tests query this column.
- `prefixTokens` / `worstItemTokens` / `worstTotalTokens` are computed deterministically in code from the real 10 CSV rows of this run. The 100-token gate asserts `worstTotalTokens ≤ 100`. `perItemTokensJson` keeps the exact per-item tokenizations for debugging.
- `prefixHash` is the cache-warmth key used to cluster versions that reuse the same cacheable prefix.
- `tokenMethod` records whether `tiktoken` was available.
- The result summary (`submitsMade`, `correctCount`, `incorrectCount`, `invalidCount`, `flagObtained`) is maintained by the runner as per-item `hub_submissions` terminate. `flagObtained = true` marks the winning version (via `status='winning'` + `runs.winning_version_id`).

---

### 4.4 `hub_submissions`

One row per POST to `/verify`. A `kind='submit'` row is tied to a `prompt_version` **and** a `csv_item`. A `kind='reset'` row is tied to neither (it's a control-plane POST).

```ts
export const hubSubmissions = sqliteTable('hub_submissions', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => runs.id),
  promptVersionId: text('prompt_version_id').references(() => promptVersions.id),  // null for reset
  csvItemId: text('csv_item_id').references(() => csvItems.id),                    // null for reset

  kind: text('kind', { enum: ['submit', 'reset'] }).notNull().default('submit'),
  iterationNo: integer('iteration_no'),                 // null for reset
  rowIndex: integer('row_index'),                       // 0..9, null for reset — dispatch order within iteration

  // Request
  requestUrl: text('request_url').notNull(),
  requestBody: text('request_body', { mode: 'json' }).notNull().$type<{
    apikey: string       // NOTE: stored for replay; scrub before export
    task: string
    answer: { prompt: string }
  }>(),
  renderedPrompt: text('rendered_prompt'),              // for kind='submit': the fully-substituted prompt actually sent; null for reset
  renderedTokens: integer('rendered_tokens'),           // tokens of renderedPrompt (locally measured, should be ≤ 100)
  requestedAt: integer('requested_at', { mode: 'timestamp' }).notNull(),

  // Response
  httpStatus: integer('http_status'),
  responseBodyRaw: text('response_body_raw'),           // verbatim text
  responseBodyJson: text('response_body_json', { mode: 'json' }), // parsed if JSON
  parseOk: integer('parse_ok', { mode: 'boolean' }),

  // Extracted from response (per-item)
  classifierOutput: text('classifier_output'),          // raw text returned by hub (pre-normalize)
  normalized: text('normalized', { enum: ['DNG', 'NEU', 'INVALID'] }),
  match: integer('match', { mode: 'boolean' }),         // true iff hub accepted this classification (no error)
  flag: text('flag'),                                   // the {FLG:...} text if returned on this POST
  hubError: text('hub_error'),                          // hub-side error message if any
  hubCounterRemaining: integer('hub_counter_remaining'),// if surfaced

  // Cost (reported by hub if available, else flat)
  inputTokensReported: integer('input_tokens_reported'),
  outputTokensReported: integer('output_tokens_reported'),
  cachedTokensReported: integer('cached_tokens_reported'),
  costUsdMillis: integer('cost_usd_millis'),

  durationMs: integer('duration_ms'),
  error: text('error'),                                 // transport/parse error (distinct from hubError)

  status: text('status', { enum: ['pending', 'ok', 'error'] }).notNull().default('pending'),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
}, (t) => [
  index('hs_run_idx').on(t.runId),
  index('hs_pv_idx').on(t.promptVersionId),
  index('hs_pv_row_idx').on(t.promptVersionId, t.rowIndex),
  // at most one terminal submit per (prompt_version, csv_item); enforced by an app-level guard + partial unique index in SQL:
  // CREATE UNIQUE INDEX hs_pv_item_submit_uq ON hub_submissions(prompt_version_id, csv_item_id) WHERE kind='submit'
  uniqueIndex('hs_pv_item_submit_uq')
    .on(t.promptVersionId, t.csvItemId)
    .where(sql`kind = 'submit'`),
  index('hs_run_kind_idx').on(t.runId, t.kind),
  index('hs_status_idx').on(t.status),
])
```

**Purpose**: the single source of truth for every hub interaction. A `kind='submit'` row captures what we rendered for one CSV item, what the hub classified it as, whether the flag was returned on that POST, and cost. A `kind='reset'` row captures reset-counter interactions.

**Key fields**:
- `requestBody` stores the exact outbound JSON. `apikey` is present for replay but redacted by export tooling.
- `renderedPrompt` is the verbatim string sent (for submits); together with `csvItemId` and `promptVersionId` it makes any single classification fully replayable.
- `renderedTokens` is the locally-measured tokenization of what was sent; calibrated against `inputTokensReported` when the hub surfaces it.
- `responseBodyRaw` is kept verbatim; `responseBodyJson` is the parsed form when applicable. The raw copy guards against Zod schema drift.
- `classifierOutput` + `normalized` split raw vs canonical so normalization bugs are auditable.
- `match` is `true` iff the hub did not flag this item as misclassified. A `match = false` row is the entry point for failure analysis.
- `flag` is nullable; the runner expects it on the last correct classification of an all-correct attempt but accepts it on any POST defensively.
- `hubCounterRemaining` is populated opportunistically; the runner uses it to decide preemptive resets before dispatching the next per-item POST.
- The partial unique index on `(prompt_version_id, csv_item_id)` where `kind='submit'` enforces idempotency: at most one terminal submit per item per prompt version per run. Resets (`kind='reset'`) have both FKs `NULL` and are not constrained by uniqueness (capped by `runs.resets_used`).

---

### 4.5 `refinements`

One row per Opus advisory call.

```ts
export const refinements = sqliteTable('refinements', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => runs.id),
  iterationNo: integer('iteration_no').notNull(),        // the iteration *after which* the refinement was requested
  previousVersionId: text('previous_version_id').references(() => promptVersions.id),
  nextVersionId: text('next_version_id').references(() => promptVersions.id),

  // Opus call
  model: text('model').notNull(),                        // e.g. 'anthropic:claude-opus-4-1'
  advisorContext: text('advisor_context').notNull(),     // full text sent to Opus (for replay)
  rawResponse: text('raw_response'),                     // raw assistant text
  parseOk: integer('parse_ok', { mode: 'boolean' }),

  // Structured response (parsed)
  analysis: text('analysis'),
  proposal: text('proposal'),
  diffSummary: text('diff_summary'),
  expectedEffect: text('expected_effect'),
  cacheImpact: text('cache_impact', { enum: ['none', 'prefix_preserved', 'prefix_mutated'] }),
  estimatedTokensHint: integer('estimated_tokens_hint'),

  // Accept/reject
  decision: text('decision', { enum: ['accepted', 'rejected_tokens', 'rejected_parse', 'fallback_shrinker', 'skipped_budget'] }).notNull(),
  authoritativeTokens: integer('authoritative_tokens'),  // from tiktoken after proposal

  // Cost
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  cachedTokens: integer('cached_tokens'),
  costUsdMillis: integer('cost_usd_millis'),
  durationMs: integer('duration_ms'),

  status: text('status', { enum: ['pending', 'ok', 'error'] }).notNull().default('pending'),
  error: text('error'),

  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
}, (t) => [
  index('ref_run_idx').on(t.runId),
  index('ref_prev_idx').on(t.previousVersionId),
  index('ref_next_idx').on(t.nextVersionId),
])
```

**Purpose**: reconstruct Opus's reasoning and its effect on the prompt lineage.

**Why it matters**:
- `advisorContext` is the exact prompt sent to Opus — mandatory for Opus trace replay and for spotting bad context constructions.
- `decision` encodes the orchestrator's independent verdict: even if Opus proposes something, we may reject on token count or parse failure.
- Linking `previousVersionId → nextVersionId` makes the prompt genealogy queryable (`WITH RECURSIVE` walks).

---

### 4.6 `failure_analyses`

One row per iteration that had any failures — the digest that was fed to Opus.

```ts
export const failureAnalyses = sqliteTable('failure_analyses', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => runs.id),
  promptVersionId: text('prompt_version_id').notNull().references(() => promptVersions.id),
  iterationNo: integer('iteration_no').notNull(),

  digest: text('digest', { mode: 'json' }).notNull().$type<{
    submissionIds: string[]                            // all kind='submit' rows of this iteration
    flag: string | null
    totals: { correct: number; incorrect: number; invalid: number; errored: number; dispatched: number }
    perItem: Array<{
      csvItemId: string
      rowIndex: number
      externalId?: string
      payloadExcerpt: Record<string, unknown>           // abbreviated CSV row
      renderedPromptExcerpt?: string                    // first N chars of the rendered prompt
      classifierOutput?: string                         // raw hub output
      normalized?: 'DNG' | 'NEU' | 'INVALID'
      match?: boolean
      hubError?: string
    }>
    firstFailureAt: { rowIndex: number; csvItemId: string } | null
    hypotheses: string[]                                // deterministic guesses (e.g. 'all failures have long descriptions')
  }>(),

  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (t) => [
  index('fa_run_idx').on(t.runId),
  uniqueIndex('fa_run_iter_uq').on(t.runId, t.iterationNo),
])
```

**Purpose**: keep the *pre-Opus* summary so we can later ask "were we giving Opus good context?" without rebuilding it from raw `hub_submissions`. Because an iteration may abort on the first misclassification (rows 5..9 never dispatched), the digest captures `totals.dispatched` and `firstFailureAt` so Opus sees exactly how far the attempt got.

---

### 4.7 `budget_usage`

Append-only ledger of every cost increment.

```ts
export const budgetUsage = sqliteTable('budget_usage', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => runs.id),
  scope: text('scope', { enum: ['verify', 'reset', 'opus', 'other'] }).notNull(),
  refType: text('ref_type', { enum: ['hub_submission', 'refinement', 'manual'] }).notNull(),
  refId: text('ref_id'),                                 // FK-like pointer to hub_submissions.id or refinements.id

  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  cachedTokens: integer('cached_tokens').notNull().default(0),
  costUsdMillis: integer('cost_usd_millis').notNull().default(0),

  runningTotalUsdMillis: integer('running_total_usd_millis').notNull(),

  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (t) => [
  index('bu_run_idx').on(t.runId),
  index('bu_run_created_idx').on(t.runId, t.createdAt),
])
```

**Purpose**: exact, replayable cost reconstruction. `runningTotalUsdMillis` denormalized so latest total is a single `ORDER BY created_at DESC LIMIT 1`.

---

## 5. Domain Mappers (sketch)

Following `01_05_agent/src/repositories/sqlite/index.ts` conventions:

- `toRun(row) → Run`
- `toCsvItem(row) → CsvItem`
- `toPromptVersion(row) → PromptVersion`
- `toHubSubmission(row) → HubSubmission`
- `toRefinement(row) → Refinement`
- `toFailureAnalysis(row) → FailureAnalysis`
- `toBudgetUsage(row) → BudgetUsage`

Each domain file (`src/domain/categorize/*.ts`) defines:
- the TypeScript interface,
- `create*` factory (same shape as `createAgent(id, input)`),
- pure transition helpers where a state machine applies (e.g. `Run.start`, `Run.markWinning`, `Verification.markOk`).

---

## 6. Repositories (sketch)

Added to `Repositories` in `src/repositories/types.ts`:

```ts
interface CategorizeRepositories {
  runs: RunRepository
  csvItems: CsvItemRepository
  promptVersions: PromptVersionRepository
  hubSubmissions: HubSubmissionRepository
  refinements: RefinementRepository
  failureAnalyses: FailureAnalysisRepository
  budgetUsage: BudgetUsageRepository
}

interface Repositories {
  users: UserRepository
  sessions: SessionRepository
  agents: AgentRepository
  items: ItemRepository
  categorize: CategorizeRepositories    // NEW facet
  ping(): Promise<boolean>
}
```

**Key methods per repo** (non-exhaustive):

- `RunRepository`:
  - `create(input: CreateRunInput): Promise<Run>`
  - `getById(id): Promise<Run | undefined>`
  - `listBySession(sessionId): Promise<Run[]>`
  - `listByLineage(lineageId): Promise<Run[]>`
  - `update(run): Promise<Run>`
  - `markWinning(runId, promptVersionId): Promise<void>`
- `CsvItemRepository`:
  - `bulkInsert(runId, items): Promise<CsvItem[]>`
  - `listByRun(runId): Promise<CsvItem[]>`
- `PromptVersionRepository`:
  - `insert(version): Promise<PromptVersion>`
  - `getById(id)`
  - `listByRun(runId)`
  - `findByContentHash(runId, hash)`
  - `recordFirstDispatch(id, at)` — sets `firstDispatchedAt` on the first per-item POST
  - `incrementSubmits(id)` / `incrementCorrect(id)` / `incrementIncorrect(id)` / `incrementInvalid(id)` — atomic counters driven by per-item `hub_submissions` terminations
  - `markFlagObtained(id, flag)` — flips `flag_obtained` and cascades `status='winning'`
  - `updateStatus(id, status, rejectReason?)`
- `HubSubmissionRepository`:
  - `insertPendingSubmit(input: NewSubmitInput): Promise<HubSubmission>` — for per-item submits
  - `insertPendingReset(input: NewResetInput): Promise<HubSubmission>` — for reset POSTs
  - `markOk(id, { httpStatus, responseBodyRaw, responseBodyJson, parseOk, classifierOutput?, normalized?, match?, flag?, hubError?, hubCounterRemaining?, usage, costUsdMillis, durationMs })`
  - `markError(id, { error, httpStatus?, durationMs })`
  - `listByPromptVersion(promptVersionId)` — includes both kinds
  - `listSubmitsByIteration(runId, iterationNo)` — ordered by `rowIndex`
  - `listByRun(runId)`
  - `getLatestResetBefore(runId, timestamp): Promise<HubSubmission | undefined>`
- `RefinementRepository`:
  - `insertPending(input)`
  - `markOk(id, parsed, cost)`
  - `markError(id, error)`
  - `listByRun(runId)`
- `FailureAnalysisRepository`:
  - `insert(analysis)`
  - `getByIteration(runId, iterationNo)`
- `BudgetUsageRepository`:
  - `append(entry, runningTotal): Promise<BudgetUsage>`
  - `currentTotal(runId): Promise<number>`
  - `listByRun(runId)`

All methods mirror the existing patterns in `01_05_agent/src/repositories/sqlite/index.ts` (pure row-to-domain mappers, atomic MAX-based sequence allocation where relevant, JSON columns used for structured payloads).

---

## 7. Migration Plan

Single new Drizzle migration appended to the existing one in `drizzle/`:

```
drizzle/
  0000_romantic_union_jack.sql         (existing)
  0001_categorize_schema.sql           (NEW)
```

`0001_categorize_schema.sql` contents (summarised):

1. `ALTER TABLE sessions ADD COLUMN experiment_lineage_id TEXT`;
2. `CREATE INDEX sessions_lineage_idx ON sessions (experiment_lineage_id)`;
3. `CREATE TABLE runs ...` + indexes;
4. `CREATE TABLE csv_items ...` + indexes + unique index;
5. `CREATE TABLE prompt_versions ...` + indexes + unique indexes;
6. `CREATE TABLE hub_submissions ...` + indexes + unique partial index `CREATE UNIQUE INDEX hs_pv_item_submit_uq ON hub_submissions(prompt_version_id, csv_item_id) WHERE kind='submit'`;
7. `CREATE TABLE refinements ...` + indexes;
8. `CREATE TABLE failure_analyses ...` + indexes + unique index;
9. `CREATE TABLE budget_usage ...` + indexes.

Pragmas (WAL, synchronous=NORMAL, foreign_keys=ON, busy_timeout=5000) are applied on connection by the existing `createSQLiteRepositories` function; the new tables inherit them automatically.

Generated via `npm run db:generate`; applied via `npm run db:push` or `npm run db:migrate`. Seed script extended to optionally create an example `run` record in dev.

---

## 8. Why Each Entity Matters

| Entity | Debug value | Iteration value |
|---|---|---|
| `runs` | Single row answers "what happened" — status, reason, flag, totals, resets used. | Drives the outer loop's stop decisions. |
| `csv_items` | Lets you replay any item manually and shows which placeholders templates may reference. | Source of truth for prompt inputs; stable across iterations. |
| `prompt_versions` | Shows every attempted template, prefix/worst-item/worst-total tokens, placeholders, which invariants were detected, why it was rejected, rollup counters for dispatch. Cache impact analysis. | Enables Opus to build on the best ancestor, not reinvent. |
| `hub_submissions` | Full forensics per per-item POST: rendered prompt, raw response, normalized classification, match/error, hub counter info, costs. Reset POSTs share the table with `kind='reset'`. | Drives per-item failure digest construction; captures all interactions with the hub. |
| `refinements` | Opus traceability: what we asked, what it said, what we did. | Ensures Opus isn't silently destroying cache. |
| `failure_analyses` | "Was the prompt Opus got good enough?" | Pre-Opus digest pattern reused across runs. |
| `budget_usage` | Exact cost reconstruction, down to the single submission. | Real-time gating decisions, breach detection. |

---

## 9. Query Examples

**Outcome by prompt version**:
```sql
SELECT pv.iteration_no,
       pv.worst_total_tokens,
       pv.mutation_class,
       pv.submits_made,
       pv.correct_count,
       pv.incorrect_count,
       pv.invalid_count,
       pv.flag_obtained
FROM prompt_versions pv
WHERE pv.run_id = ?
ORDER BY pv.iteration_no;
```

**Per-item classification breakdown for one iteration**:
```sql
SELECT hs.row_index,
       ci.external_id,
       hs.rendered_prompt,
       hs.normalized,
       hs.match,
       hs.hub_error,
       hs.cost_usd_millis
FROM hub_submissions hs
JOIN csv_items ci ON ci.id = hs.csv_item_id
WHERE hs.prompt_version_id = ? AND hs.kind = 'submit'
ORDER BY hs.row_index;
```

**Which items consistently fail across iterations**:
```sql
SELECT ci.external_id,
       COUNT(*) AS attempts,
       SUM(CASE WHEN hs.match = 1 THEN 1 ELSE 0 END) AS successes
FROM hub_submissions hs
JOIN csv_items ci ON ci.id = hs.csv_item_id
WHERE hs.run_id = ? AND hs.kind = 'submit' AND hs.status = 'ok'
GROUP BY ci.id
ORDER BY successes ASC, attempts DESC;
```

**Resets and their budget impact**:
```sql
SELECT hs.requested_at, hs.cost_usd_millis, hs.status
FROM hub_submissions hs
WHERE hs.run_id = ? AND hs.kind = 'reset'
ORDER BY hs.requested_at;
```

**Prompt lineage for a run**:
```sql
WITH RECURSIVE lineage(id, parent_id, depth, prefix_hash, iteration_no) AS (
  SELECT id, parent_version_id, 0, prefix_hash, iteration_no
  FROM prompt_versions WHERE run_id = ? AND parent_version_id IS NULL
  UNION ALL
  SELECT pv.id, pv.parent_version_id, l.depth + 1, pv.prefix_hash, pv.iteration_no
  FROM prompt_versions pv JOIN lineage l ON pv.parent_version_id = l.id
)
SELECT * FROM lineage ORDER BY iteration_no;
```

**Current spend**:
```sql
SELECT running_total_usd_millis
FROM budget_usage
WHERE run_id = ?
ORDER BY created_at DESC
LIMIT 1;
```

**Cache warmth across versions** (how often each prefix was reused):
```sql
SELECT prefix_hash, COUNT(*) AS reused
FROM prompt_versions
WHERE run_id = ?
GROUP BY prefix_hash
ORDER BY reused DESC;
```

---

## 10. Summary

- Seven new tables, one column addition to `sessions`, zero breaking changes.
- Write-ahead discipline everywhere an external call is made, so crashes are recoverable.
- Denormalized summary fields on `prompt_versions` + `runs` for dashboard-speed queries; canonical source remains `hub_submissions` (one row per POST) and `budget_usage`.
- Reset and submit are unified under one table with a `kind` discriminator, so cost and cadence analyses don't need a UNION.
- Everything required to answer the debugging questions ("what did we send?", "what did the hub return?", "was the flag present?", "what did Opus propose?", "how much did it cost?", "was cache preserved?", "how many resets did we burn?") is a single indexed query away.
