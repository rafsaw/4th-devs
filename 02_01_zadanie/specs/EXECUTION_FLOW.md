# EXECUTION_FLOW — `categorize` Exercise

> Step-by-step runbook of a single `categorize` run. Every step names the responsible module, the DB writes, the events emitted, and the stop conditions that can short-circuit the step.

Conventions:
- `[code]` = module responsible
- `[db]` = persistence side effect
- `[event]` = event emitted on the `AgentEventEmitter`
- `[trace]` = Langfuse span/generation produced

---

## 0. Preconditions

Before any run starts:

1. `.env` is populated: `HUB_BASE_URL`, `HUB_API_KEY`, Opus key (`ANTHROPIC_API_KEY` or `OPENROUTER_API_KEY`), `DATABASE_URL`, Langfuse keys (optional).
2. DB is migrated: `npm run db:push` (applies `0000_*` + `0001_categorize_schema.sql`).
3. User is seeded: `npm run db:seed` creates the default user so `categorize` runs have a `user_id`.
4. Runtime is booted via `initRuntime()` (reused from `01_05_agent`), which:
   - initializes Langfuse/OTel (no-op if keys absent);
   - registers providers (OpenAI/Gemini/OpenRouter + Anthropic if key present);
   - creates SQLite repositories;
   - creates the tool registry (categorize registers no tools);
   - attaches `subscribeEventLogger` and `subscribeLangfuse`;
   - additionally constructs the `categorize` facet: `{ hub, tokenizer, budget, optimizer }`.
5. Hub is reachable (a health probe may be done on demand).

---

## 1. Initialize Run

**Entry point**: CLI `categorize run [--continue-lineage <id>]` or, later, `POST /api/categorize/run`.

Steps:

1.1 **Authenticate user** — `[code]` existing `bearerAuth` middleware or CLI uses `SEED_API_KEY`.

1.2 **Create session** — `[code]` `sessionRepo.create(userId, title='categorize')` → `[db]` insert into `sessions`. If `--continue-lineage` is set, reuse the `experiment_lineage_id`; otherwise generate a new one and store it on the session.

1.3 **Create root agent** — `[code]` `agentRepo.create({ sessionId, task: 'categorize', config: { model: <opus model for advisor only, informational> } })` → `[db]` insert into `agents`.

1.4 **Create run** — `[code]` `runRepo.create({ id, sessionId, rootAgentId, userId, taskName, hubBaseUrl, experimentLineageId, limitsJson })` with `status='pending'` → `[db]` insert into `runs`.

1.5 **Generate `traceId`** and store on the root agent (same pattern as `01_05_agent`).

1.6 **Emit `run.started`** — `[event]` carrying `{ runId, sessionId, taskName, limits, budget }`.
- `[trace]` Langfuse subscriber opens the top-level agent observation with `name='categorize'`, `input=taskName`, `sessionId`, `userId` propagated to trace-level.

1.7 **Transition run**: `pending → running` via `runRepo.update`. `[db]` update `runs.status`, `runs.started_at`.

---

## 2. Optional Hub Reset

The hub has no dedicated reset route; resets are an in-band payload to `/verify`. Performed mid-run when a prior per-item submission signals the hub-side counter is exhausted, after a misclassification-aborted attempt, or when `--reset-on-start` is passed.

2.1 `[code]` `budget.canAfford(resetFlatCost)` — respect the budget even for reset submissions.

2.2 `[db]` `hubSubmissionRepo.insertPendingReset({ runId, kind: 'reset', iterationNo, requestUrl, requestBody: { apikey, task: 'categorize', answer: { prompt: 'reset' } } })` **before** the POST (write-ahead).

2.3 `[code]` `hubClient.reset()` — POST `/verify`.

2.4 **On response**: `[db]` `hubSubmissionRepo.markOk(id, { httpStatus, responseBodyRaw, responseBodyJson, parseOk, durationMs })`; `[db]` increment `runs.resets_used`; `[db]` `budgetUsage.append({ scope: 'reset', refType: 'hub_submission', refId: submissionId, ... })`.
- `[event]` `reset.performed({ iterationNo, reason })` + `budget.consumed({ scope: 'reset', ... })`.
- `[trace]` Langfuse generation span (model=`hub:categorize`, metadata `isReset=true`).

2.5 **On failure**: `[db]` `markError`; `[event]` `verify.failed` with `isReset=true` metadata; if persistent → `run.failed(reason='hub_unavailable')`.

2.6 **Reset cap**: if `runs.resets_used > CATEGORIZE_MAX_RESETS`, proceed directly to §13 with `stop_reason='resets_exhausted'`.

In a normal first-attempt run this step is skipped; the orchestrator calls it only when previous per-item responses explicitly indicated counter exhaustion or after a misclassified attempt.

---

## 3. Download Fresh CSV

3.1 `[code]` `csv/downloader.ts` issues a GET to `https://hub.ag3nts.org/data/{API_KEY}/categorize.csv`. The API key is embedded in the URL path — no bearer header.

3.2 On success:
- compute `sha256` of bytes;
- `[db]` `runRepo.update` to set `csv_sha256`, `csv_raw`, `csv_downloaded_at`;
- continue.

3.3 On failure after retries:
- `[event]` `run.failed(reason='hub_unavailable')`;
- finalize (see §13).

---

## 4. Persist Input Items

4.1 `[code]` `csv/parser.ts` decodes the CSV, extracts `columnNames`, and produces 10 `NewCsvItem` objects whose `payload` is keyed by column name.

4.2 **Shape check**: if `rows.length !== 10`, fail the run with `stop_reason='csv_shape'`.

4.3 `[db]` `runRepo.update({ csvColumns: columnNames })` — the column list is now available to the prompt validator.

4.4 `[db]` `csvItemRepo.bulkInsert(runId, rows)` — 10 rows into `csv_items` in a single transaction.

No event is emitted per item; one summary log line is enough.

---

## 5. Create First Prompt Candidate

5.1 `[code]` `prompt/strategy.ts` constructs the initial candidate template:
- `prefix` = carefully-authored static text (terse, cache-friendly, **must contain all required invariants from SPEC §7.4**) — source lives in `workspace/prompts/categorize/base.prefix.md` and is versioned in git;
- `outputContract` = fixed line, e.g. "Odpowiedz DNG lub NEU.";
- `placeholderLine` = fixed, e.g. "ID {id}: {description}";
- `templateFull = prefix + outputContract + placeholderLine` (placeholders still literal).

5.2 `[code]` `prompt/validator.ts` runs three gates:

- **Placeholder gate**: extract placeholders from `templateFull` via regex `\{([a-zA-Z_][a-zA-Z0-9_]*)\}`; assert every placeholder ∈ `runs.csv_columns` — else `[db]` insert `prompt_versions` row with `status='rejected'`, `reject_reason='unknown_placeholder'`.
- **Invariant gate**: for each required invariant (`INV-OUTPUT`, `INV-REACTOR-NEU`, ...) run its detection regex against the prefix; assert every required invariant is detected — else `reject_reason='invariant_removed'` (list which ones were missing). Record the detected set in `invariants_present`.
- **Worst-case token gate** (see §5.3).

5.3 `[code]` `tokens/estimator.estimateWorstCase(template, csvItems)`:
- renders the template against every one of the 10 CSV rows (via `prompt/renderer.ts`);
- tokenizes each rendered string with tiktoken;
- returns `{ prefixTokens, perItemTokens: number[10], worstItemTokens, worstTotal }`.

5.4 **Token gate**: if `worstTotal > 100`:
- `[db]` insert `prompt_versions` row with `status='rejected'`, `reject_reason='exceeds_100_tokens'`, `worst_total_tokens`;
- invoke the **deterministic shrinker** (§10.5 of SPEC) and retry from 5.2;
- if the shrinker also cannot produce a valid candidate, `run.failed(reason='compression')`.

5.5 **Persist accepted candidate**: `[db]` `promptVersionRepo.insert(...)` with `iteration_no=1`, `status='accepted'`, `mutation_class='none'`, `placeholders`, `invariants_present`, `prefix_hash`, `content_hash`, `prefix_tokens`, `worst_item_tokens`, `worst_total_tokens`, `per_item_tokens_json`, `encoding`, `token_method`.

5.6 Log `prompt_version.created` (minor info log; no dedicated event type needed).

---

## 6. Estimate Cost & Budget Risk Before Sending

6.1 `[code]` `budget/tracker.ts`:
- `plannedAttemptCost = 10 * perPostFlatCostUsd` (or last-observed hub-reported cost × 10, whichever is larger) — covers the 10 per-item POSTs of this attempt;
- optionally add `resetFlatCostUsd` if a reset is expected to precede this attempt;
- optionally add an estimate for the next Opus call if refinement is likely to follow;
- consult `runningTotal` from `budget_usage`;
- `canAfford(plannedAttemptCost + optional reset + optional opus)`.

6.2 If not affordable:
- `[event]` `budget.breached({ scope: 'verify', limit, attemptedTotal })`;
- transition the run to finalization with `stop_reason='budget'`.

6.3 If affordable, continue to §7.

---

## 7. Submit Rendered Prompts (10 POSTs per iteration)

7.1 **Emit `iteration.started`** — `[event]` `{ iterationNo, promptVersionId, prefixTokens, worstItemTokens, cacheStrategy: mutationClass }`.
- `[trace]` Langfuse subscriber opens a nested span for the iteration. All 10 per-item generations nest under this span.

7.2 `[code]` Initialize per-iteration counters: `correct=0, incorrect=0, invalid=0, errors=0, dispatched=0, flagFound=null`. `[db]` `promptVersionRepo.recordFirstDispatch(promptVersionId, now)`.

7.3 **For each `csv_item` in `csv_items` (ordered by `row_index` 0..9)**:

  7.3.1 `[code]` `renderedPrompt = renderer.render(template, csvItem.payload)` — substitutes every `{col}` token.

  7.3.2 `[code]` `renderedTokens = tokens.estimateText(renderedPrompt)`. Defensive per-POST gate: if `renderedTokens > 100` (should be impossible after §5 worst-case gate on this run's CSV, but guards against resume against a mutated CSV), `[db]` insert `hub_submissions` row with `kind='submit'`, `status='error'`, `error='item_token_overflow'`, skip to next item; `errors++`.

  7.3.3 `[code]` `budget.canAfford(perPostFlatCostUsd)` — last-second gate; if it flips: `[event]` `budget.breached({ scope: 'verify', ... })`, break the loop and proceed to 7.4.

  7.3.4 **Write-ahead**: `[db]` `hubSubmissionRepo.insertPendingSubmit({ runId, promptVersionId, csvItemId, iterationNo, rowIndex, requestUrl, requestBody: { apikey, task, answer: { prompt: renderedPrompt } }, renderedPrompt, renderedTokens, requestedAt: now })` → returns `submissionId`.

  7.3.5 `[event]` `verify.called({ iterationNo, promptVersionId, csvItemId, rowIndex, renderedTokens })`.

  7.3.6 `[code]` `hubClient.submit(renderedPrompt)` — one HTTP POST.

  7.3.7 **On response (HTTP 2xx)**:
  - `[code]` `hub/parser.ts` validates shape via Zod, extracts `classifierOutput`, `flag` (scan for `{FLG:...}`), `hubError`, `hubCounterRemaining` when surfaced;
  - `[code]` `hub/normalize.ts` normalizes `classifierOutput` to `DNG | NEU | INVALID`;
  - derive `match = (hubError == null && normalized !== 'INVALID')`;
  - `[db]` `hubSubmissionRepo.markOk(submissionId, { httpStatus, responseBodyRaw, responseBodyJson, parseOk, classifierOutput, normalized, match, flag, hubError, hubCounterRemaining, usage, costUsdMillis: usage?.costUsdMillis ?? perPostFlatCostUsdMillis, durationMs })`;
  - `[db]` counter updates on `prompt_versions`: if `match && normalized==='DNG'|'NEU'` → `incrementCorrect`, else if `normalized==='INVALID'` → `incrementInvalid`, else → `incrementIncorrect`. Always `incrementSubmits`.
  - `[db]` `budgetUsage.append({ scope: 'verify', refType: 'hub_submission', refId: submissionId, ... }, runningTotal)`;
  - `[event]` `verify.completed({ iterationNo, promptVersionId, csvItemId, rowIndex, rawOutput: classifierOutput, normalized, match, durationMs, cost, flag? })`;
  - `[event]` `budget.consumed({ scope: 'verify', usdDelta, tokenDelta, runningTotal })`;
  - `[trace]` Langfuse generation span created (model=`hub:categorize`, input=renderedPrompt, output=responseBodyRaw, usage=usage).
  - update local counters (`correct++` | `incorrect++` | `invalid++`), `dispatched++`.
  - **Flag detected**: if `flag != null` → `flagFound = flag`; `[db]` `promptVersionRepo.markFlagObtained(promptVersionId, flag)`; `[db]` `runRepo.update({ flag, winning_version_id: promptVersionId })`; **break loop**.
  - **Misclassification detected**: if `!match` or `hubError != null` → **break loop** (fail-fast, skip remaining per-item POSTs; save budget for refinement).

  7.3.8 **On error (5xx/timeout after retries, or Zod parse failure)**:
  - `[db]` `hubSubmissionRepo.markError(submissionId, { error, httpStatus?, durationMs })`;
  - `[event]` `verify.failed({ iterationNo, promptVersionId, csvItemId, rowIndex, error, durationMs })`;
  - `errors++`;
  - if the hub is persistently down (3+ consecutive errors across items) → break loop and escalate run to `stop_reason='hub_unavailable'`.

  7.3.9 **Hub-counter exhaustion detection**: if any per-item response indicates counter exhaustion (`hubCounterRemaining === 0` or explicit error), break the loop; §7.4 will decide whether to reset or stop.

7.4 **Emit `iteration.completed`** — `[event]` `{ iterationNo, correct, incorrect, invalid, errors, flag: flagFound }`.
- `[trace]` Langfuse closes the iteration span.

7.5 **Post-iteration reset decision**: if the loop aborted due to hub-counter exhaustion and `flagFound == null`, perform §2 (reset) **before** any subsequent iteration's §6.

---

## 8. Persist Results (implicit in §7)

Persistence is interleaved with dispatch. By the end of §7, for this iteration:
- 1..10 `hub_submissions` rows with `kind='submit'` (each terminal — `ok` or `error`); exactly 10 on a fully-dispatched attempt, fewer if the loop aborted early;
- 0..N `hub_submissions` rows with `kind='reset'` if §2 was triggered before this iteration;
- the iteration's `prompt_versions` row has updated `submits_made`, `correct_count`, `incorrect_count`, `invalid_count`, and `flag_obtained` (true iff the flag was returned on one of the POSTs);
- 1..11 rows in `budget_usage` for this iteration (one per per-item POST, optionally one for the preceding reset).

---

## 9. Decision: Success, Stop, or Refine

9.1 `[code]` orchestrator inspects the iteration outcome (current `prompt_versions` row + per-item `hub_submissions` of this iteration):

  9.1.1 **Success condition**: `prompt_versions.flag_obtained === true`.
  - → go to §13 (finalize `completed`). `winning_version_id` and `runs.flag` were already persisted in 7.3.7.

  9.1.2 **Hard stop conditions** (no more iterations):
  - `iteration_no >= CATEGORIZE_MAX_ITERATIONS`; or
  - budget tracker already at `breached`; or
  - `runs.resets_used > CATEGORIZE_MAX_RESETS`; or
  - persistent hub failure; or
  - deterministic shrinker exhausted; or
  - invariant unrecoverable (validator keeps rejecting every candidate).
  - Any of these → go to §13 with the appropriate `stop_reason`.

  9.1.3 Otherwise → proceed to §10 (refinement).

---

## 10. Analyze Failures

10.1 `[code]` `optimizer/refiner.ts` constructs a failure digest from the per-item `hub_submissions` rows of this iteration (ordered by `rowIndex`):
- for every dispatched submit: gather `{ csvItemId, rowIndex, externalId, payloadExcerpt (abbreviated CSV row), renderedPromptExcerpt (first ~200 chars), classifierOutput, normalized, match, hubError }`;
- `firstFailureAt = the first row where match === false`;
- totals: `correct`, `incorrect`, `invalid`, `errored`, `dispatched`;
- compute deterministic hypotheses where cheap (e.g. "all incorrect rows have `description` containing word X", "all invalid outputs come after the same character position", "reactor-parts clause may have been overridden by description content");
- produce the digest object matching the `failure_analyses.digest` schema.

10.2 `[db]` `failureAnalysisRepo.insert({ runId, promptVersionId, iterationNo, digest })`.

No event emitted at this step — the digest is an internal construct. (Consumers inspect it via the `refine.requested` event payload or the DB.)

---

## 11. Call Claude Opus for Refinement Proposal

11.1 **Budget check** for Opus itself: `budget.canAfford(estimatedOpusCost)`. If not:
- the iteration ends with `decision='skipped_budget'` on a stub `refinements` row;
- proceed to §13 with `stop_reason='budget'`.

11.2 **Emit `refine.requested`** — `[event]` `{ iterationNo, previousVersionId, failureCount }`.

11.3 `[code]` `optimizer/refiner.ts` assembles advisor context:
- load `workspace/agents/opus-prompt-engineer.agent.md` (task brief, hard constraints, placeholder rules, **required invariants from SPEC §7.4 listed as must-preserve**, output JSON schema, mutation-class table);
- append CSV schema (column list) and up to 3 representative CSV rows (shortest, longest, median by payload length — abbreviated);
- append current candidate template (prefix + contract + placeholder line) with `prefixTokens`, `worstItemTokens`, `worstTotal`;
- append the failure digest (truncated to budget-aware length);
- append budget snapshot (remaining USD, remaining iterations, resets used);
- append up to 2 prior refinements' `analysis + diff_summary` if they exist.

11.4 `[db]` `refinementRepo.insertPending({ runId, iterationNo, previousVersionId, model, advisorContext })` → returns a `refinements.id`.

11.5 `[code]` `optimizer/opus-client.ts` calls the provider registry with:
- `model = CATEGORIZE_OPUS_MODEL` (e.g. `anthropic:claude-opus-4-1`);
- `temperature = 0.3`, `maxOutputTokens = 1000`;
- input = the assembled advisor context as a single user message, plus a brief system message from the agent template frontmatter.
- `[trace]` generation span created automatically by the provider adapter (same path as `01_05_agent` chat agents).

11.6 **On response**:
- parse raw text as JSON via Zod;
- if parse OK → `[db]` `refinementRepo.markOk(id, parsed, { inputTokens, outputTokens, cachedTokens, costUsdMillis, durationMs })`;
- `[db]` `budgetUsage.append({ scope: 'opus', refType: 'refinement', refId: refinementId, ... }, runningTotal)`;
- `[event]` `budget.consumed({ scope: 'opus', ... })`.

11.7 **On parse failure**:
- one corrective retry: re-invoke Opus with a terse "your previous response was not valid JSON; return only JSON per schema" message;
- if second failure → `[db]` `refinementRepo.markError(id, 'parse_failed')`, decide fallback per 12.4.

11.8 `[event]` `refine.completed({ iterationNo, previousVersionId, newVersionId?, analysis, diffSummary, opusCost, opusTokens })` once a next version is accepted (§12), or `refine.failed` if not.

---

## 12. Create Next Prompt Version

12.1 `[code]` `prompt/strategy.ts`:
- assemble the proposed template from Opus's `{prefix, outputContract, placeholderLine}`;
- compute `mutationClass` by diffing Opus's proposed prefix vs current prefix (A/B/C/D);
- compute `prefix_hash`, `content_hash`, `prefix_reuse_ratio_bp`.

12.2 **Placeholder gate** (first — cheapest):
- extract placeholders from the proposal; if any ∉ `csv_columns`:
  - `[db]` `refinementRepo.update(id, { decision: 'rejected_placeholder' })`;
  - optionally ask Opus one corrective turn with the explicit column list, OR fall back to deterministic shrinker on previous version.

12.3 **Invariant gate**:
- run each required-invariant detection regex against the proposed prefix;
- if any required invariant is missing:
  - `[db]` `refinementRepo.update(id, { decision: 'rejected_invariant', missingInvariants: [...] })`;
  - issue one corrective Opus turn naming the missing invariant(s), OR fall back to deterministic shrinker on previous version that preserves invariants by construction.

12.4 **Worst-case token gate**:
- `tokens.estimateWorstCase(proposedTemplate, csvItems) → { prefixTokens, perItemTokens, worstItemTokens, worstTotal }`;
- if `worstTotal > 100`:
  - `[db]` `refinementRepo.update(id, { decision: 'rejected_tokens', authoritativeWorstTotal: worstTotal })`;
  - run the deterministic shrinker on Opus's proposal;
  - re-gate (keeping invariants);
  - if still over budget → `decision='fallback_shrinker'` with shrinker output, OR `run.failed(reason='compression')`.

12.5 **Persist accepted next version**:
- `[db]` `promptVersionRepo.insert(...)` with `iteration_no = prev + 1`, `parent_version_id = previousVersionId`, `refinement_id`, full bodies, placeholders, `invariants_present`, hashes, `prefix_tokens`, `worst_item_tokens`, `worst_total_tokens`, `per_item_tokens_json`, `mutation_class`, `prefix_reuse_ratio_bp`, `status='accepted'`;
- `[db]` `refinementRepo.update(id, { decision: 'accepted', nextVersionId })`.

12.6 **Fallback decisions** (captured in `refinements.decision`):
- `rejected_parse` — both Opus attempts returned malformed JSON; deterministic shrinker used;
- `rejected_placeholder` — Opus referenced a non-existent CSV column;
- `rejected_invariant` — Opus stripped a required invariant (e.g. the reactor-parts clause);
- `rejected_tokens` — Opus's proposal exceeded 100-token worst-case;
- `fallback_shrinker` — deterministic shrinker produced the new version;
- `skipped_budget` — Opus not called because budget breach imminent.

---

## 13. Repeat Until Success or Stop

13.1 If a new `prompt_versions` row was accepted and stop conditions don't apply, the orchestrator increments the iteration counter on `runs.iterations_used` and loops to §6 (budget check for the next iteration).

13.2 Otherwise the run enters finalization:

  **Success**:
  - `[db]` `runRepo.update({ status: 'completed', stop_reason: 'success', completed_at, result })` (`flag` and `winning_version_id` were already set in 7.3.7);
  - `[db]` `promptVersionRepo.updateStatus(winningId, 'winning')`;
  - `[event]` `run.completed({ runId, durationMs, finalStatus: 'completed', flag, iterationsUsed, totalCostUsd, totalTokens })`;
  - `[trace]` Langfuse closes the top-level agent observation with `output = resultSummary` (including the flag).

  **Failure**:
  - `[db]` `runRepo.update({ status: 'failed', stop_reason, completed_at, error })` with `stop_reason ∈ { 'iteration_cap', 'budget', 'compression', 'hub_unavailable', 'csv_shape', 'resets_exhausted', 'invariant_unrecoverable', 'internal' }`;
  - `winning_version_id` may still point at the best iteration so far;
  - `[event]` `run.failed({ runId, error, stopReason })`;
  - `[trace]` agent observation ends with `level='ERROR', statusMessage=error`.

  **Cancellation (SIGINT)**:
  - abort any in-flight verify/Opus call;
  - mark pending DB rows as interrupted (status stays `pending`, orchestrator logs the IDs for resume);
  - `[db]` `runRepo.update({ status: 'cancelled', completed_at })`;
  - `[event]` `run.cancelled`;
  - shut down tracing via existing `shutdownTracing()`.

13.3 Finally, flush telemetry and return the `Result<RunSummary, RunError>` to the caller.

---

## 14. Resume Semantics

On `categorize resume --run <runId>`:

14.1 Load the `runs` row. If terminal (`completed | failed | cancelled`), refuse unless `--force-new-lineage` is provided (in which case a new run is started with the same `experiment_lineage_id`).

14.2 If `status ∈ { pending, running }`:
- treat the process as crashed;
- load the last `prompt_versions` row for this run;
- list `hub_submissions` rows for `(runId, promptVersionId)` ordered by `(kind, row_index)`:
  - for every `kind='submit'` row with `status='pending'` → re-issue the POST (the partial unique index `(prompt_version_id, csv_item_id) WHERE kind='submit'` allows exactly one row per item; we update it in place);
  - for every `kind='reset'` row with `status='pending'` → re-issue;
  - rows with terminal status are left alone.
- after pending submissions are reconciled, if the iteration still needs items 0..9 that never got a row → dispatch them in order as in §7.3 (cache warmth lost for those items but correctness preserved).
- re-evaluate §9; proceed.

14.3 If `status='waiting'` (reserved for future human-in-the-loop flows): require an explicit resume command that provides the missing input.

---

## 15. Timing & Ordering Summary

A normal run is one pass of §1–§13. A run with refinement is §1–§5, then repeated §6–§12, terminating in §13. Each iteration is ordered like this:

```
iteration_start
  ├─ (optional) §2 reset: persist pending → POST → markOk → resets_used++ → budget.consumed(reset)
  │
  └─ §7 per-item loop (row 0..9, SEQUENTIAL, fail-fast):
       for each csv_item:
         render → token gate → budget gate
         → persist pending hub_submissions (kind='submit', csv_item_id, rendered_prompt)
         → verify.called
         → POST /verify
         → parse + normalize → markOk | markError
         → prompt_versions counters++ + budget.consumed(verify) + verify.completed
         → break loop on: flag_found | misclassification | error threshold | counter_exhausted
iteration_end
  → iteration.completed { correct, incorrect, invalid, errors, flag? }
  → decision (§9):
       success  → §13 finalize(completed)
       stop     → §13 finalize(failed)
       refine   → §10 failure digest → persist failure_analysis
                → §11 budget check opus → call opus → parse → persist refinement
                → §12 placeholder gate → invariant gate → token gate → persist next prompt_version
                → loop to §6 for the next iteration (optionally preceded by §2 reset)
```

No step in this chain is allowed to skip persistence or event emission. That is what makes the run fully replayable.

---

## 16. Observability Checklist (per run)

A completed run emits, at minimum:

- 1 × `run.started`
- 1 × `run.completed` or `run.failed` or `run.cancelled`
- ≥ 1 × `iteration.started` + matching `iteration.completed` (one pair per iteration)
- 1–10 × `verify.called` + matching `verify.completed`/`verify.failed` per iteration (full 10 only on fully-dispatched attempts)
- 0–N × `reset.performed` (one per reset submission)
- 0–N × `refine.requested` + matching `refine.completed` or `refine.failed` (one pair per refinement attempt)
- N × `budget.consumed` (one per per-item POST, one per reset, one per Opus success)
- 0–1 × `budget.breached` if a cap was hit

All events carry the same `EventContext` (traceId, sessionId, agentId, rootAgentId, depth, timestamp) extended with `runId` and `iterationNo`, so every span in Langfuse is linkable back to the originating run row.

---

## 17. End-State Invariants

At the moment a run reaches a terminal state, the following must hold (asserted in tests):

1. `runs.status ∈ { completed, failed, cancelled }` and `completed_at` is set.
2. `runs.iterations_used === MAX(prompt_versions.iteration_no WHERE run_id = runId AND status != 'rejected')`.
3. For every `prompt_versions` row with `status='accepted'` and `first_dispatched_at IS NOT NULL`: the count of `hub_submissions (prompt_version_id=pv.id, kind='submit', status IN ('ok','error'))` is between 1 and 10; and it equals 10 iff `flag_obtained = false AND incorrect_count = 0 AND invalid_count = 0 AND errors = 0` (i.e. all 10 were dispatched successfully with `match = true`, yet the hub still did not return the flag — anomalous; should not occur in practice).
4. For every `prompt_versions.flag_obtained = true` row: there is exactly one `hub_submissions` row for it with non-null `flag`; that row's `csv_item_id` is the last-dispatched item; `runs.flag` equals that flag; `runs.winning_version_id` equals that prompt version id.
5. For every accepted `prompt_versions` row: `correct_count + incorrect_count + invalid_count ≤ submits_made` and `submits_made = COUNT(hub_submissions WHERE prompt_version_id=pv.id AND kind='submit' AND status='ok')`.
6. Every `invariants_present` on accepted rows is a superset of the required invariant set (SPEC §7.4).
7. Every `hub_submissions` row with `kind='submit' AND status='ok'` has `rendered_tokens ≤ 100` and `csv_item_id IS NOT NULL`.
8. `SUM(budget_usage.cost_usd_millis WHERE run_id = runId) === runs.total_cost_usd_millis`.
9. `runs.resets_used === COUNT(hub_submissions WHERE run_id = runId AND kind = 'reset' AND status = 'ok')`.
10. `runs.total_input_tokens === SUM(hub_submissions.rendered_tokens WHERE run_id = runId AND kind = 'submit' AND status = 'ok') + SUM(refinements.input_tokens WHERE run_id = runId AND status = 'ok')`.
11. If `runs.status = 'completed'`, then `runs.winning_version_id` is set, `runs.flag` is set, and the referenced `prompt_versions` row has `status='winning'` and `flag_obtained = true`.
12. No `hub_submissions.status = 'pending'` rows remain (if any exist, the run is not terminal — it's either `cancelled` or a resume candidate).

These invariants are the contract that `test/categorize/trace.spec.ts` and `test/categorize/run-manager.spec.ts` verify after synthetic runs.
