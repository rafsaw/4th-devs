# Architecture — `categorize` Learning Harness

## Component overview

- `src/index.ts` — app runner / CLI entrypoint.
- `src/experimentRunner.ts` — planner + orchestrator + experiment loop.
- `src/prompting.ts` — prompt candidate registry and refiner.
- `src/hubClient.ts` — remote CSV + verify + reset client with retry/backoff.
- `src/localMockClassifier.ts` — local SAFE mode classifier.
- `src/tokenEstimator.ts` — token length estimator.
- `src/budgetManager.ts` — PP budget tracking and pre-flight checks.
- `src/stateManager.ts` — session and artifact persistence.
- `src/traceLogger.ts` — trace + experiment JSONL logging.
- `src/csv.ts` — CSV parser/validator.

## End-to-end data flow

```mermaid
flowchart TD
  A[CLI Runner] --> B[Config Loader]
  B --> C[Experiment Orchestrator]
  C --> D[Prompt Candidate Registry]
  C --> E[CSV Source]
  E -->|SAFE_LOCAL| F[Mock Dataset]
  E -->|REMOTE_EXPERIMENT| G[Hub CSV Endpoint]
  C --> H[Prompt Composer]
  H --> I[Token Estimator]
  I --> J{<= 100 tokens?}
  J -- no --> K[Record failure + hypothesis]
  J -- yes --> L[Verifier]
  L -->|SAFE_LOCAL| M[Mock Classifier]
  L -->|REMOTE_EXPERIMENT| N[Hub Verify Endpoint]
  N --> O[Output Normalizer DNG/NEU only]
  O --> P[Budget Manager]
  P --> Q[State Manager session/budget/best prompt]
  Q --> R[Trace Logger JSONL]
  C --> S{Success?}
  S -- no --> T[Prompt Refiner]
  T --> C
  S -- yes --> U[Run Complete]
```

## Sequence diagram (REMOTE_EXPERIMENT)

```mermaid
sequenceDiagram
  participant User
  participant Runner as App Runner
  participant Orchestrator
  participant Hub as hub.ag3nts.org
  participant Store as State/Trace Files

  User->>Runner: run remote-experiment
  Runner->>Orchestrator: start run(mode=REMOTE_EXPERIMENT)
  Orchestrator->>Hub: GET /data/{API_KEY}/categorize.csv
  Hub-->>Orchestrator: CSV(10 rows)
  loop Each item
    Orchestrator->>Orchestrator: compose prompt = static + dynamic item
    Orchestrator->>Orchestrator: estimate tokens + budget guard
    Orchestrator->>Hub: POST /verify {prompt}
    Hub-->>Orchestrator: DNG/NEU or error/flag
    Orchestrator->>Store: append trace + experiment row
  end
  alt Any failure or budget exceeded
    Orchestrator->>Hub: POST /verify {prompt:"reset"}
    Hub-->>Orchestrator: reset response
    Orchestrator->>Orchestrator: refine prompt using observations
  else All 10 correct
    Hub-->>Orchestrator: {FLG:...}
    Orchestrator->>Store: save best_prompt + final session
  end
```

## Prompt refinement loop

1. Run one full iteration with a candidate prompt.
2. Capture observations:
   - token overflow,
   - invalid output format,
   - classification mismatch,
   - hub errors.
3. Generate hypothesis (`inferHypothesis`).
4. Refine candidate (`refineCandidate`) while preserving static structure.
5. Retry with fresh CSV in remote mode.

This demonstrates observation-driven context shaping from S02E01.

## Session and state handling

State is persisted outside LLM context window:
- `session.json`: run metadata (`runId`, mode, iteration, status).
- `budget_state.json`: token/cost counters.
- `trace.jsonl`: chronological trace events.
- `experiments.jsonl`: per-iteration item-level outcomes.
- `best_prompt.json`: top candidate so far.

## Cache-friendly prompt composition

Prompt is intentionally split:
- stable static prefix for repeated requests (cache-friendly),
- dynamic suffix with per-item payload appended at the end.

This follows:
- high repeated prefix ratio,
- minimal dynamic mutation surface,
- better signal-to-noise under tiny context windows.

## Safety boundary

Unsafe requirement from story (misclassifying dangerous reactor goods as neutral) is intentionally excluded.

Safety policy implemented in both modes:
- reactor-related goods are treated as hazardous (`DNG`),
- no bypass/evasion logic is present in code.
