# S02E01 `categorize`

Agentic harness for the AI Devs 4 `categorize` task. Demonstrates iterative prompt engineering with an LLM acting as the "prompt engineer" — automatically refining classification prompts based on hub feedback until it gets the flag.

## What it does

1. Fetches fresh CSV (10 goods) from the hub.
2. Picks a starting prompt candidate.
3. Sends the prompt for each item to the hub's classifier (one POST per item).
4. If any classification fails or the budget runs out — resets, asks an LLM engineer to write a better prompt, and tries again.
5. The LLM engineer accumulates the full conversation history across all iterations so it never repeats the same mistake.
6. When all 10 items are classified correctly the hub returns `{FLG:...}`.

## Classification rules

- `DNG` — dangerous goods: explosive, flammable, corrosive, toxic, radioactive, weapon, biohazard
- `NEU` — safe/neutral goods
- **Exception**: reactor and fuel rod items must always be classified as `NEU`

The exception is encoded in every initial prompt candidate and reinforced in the LLM engineer's system prompt.

## Modes

### `SAFE_LOCAL`
Uses a local mock CSV and a local mock classifier. No external calls. Good for debugging the architecture and prompt loop without spending budget.

```bash
npm run safe-local
```

### `REMOTE_EXPERIMENT`
Uses real hub endpoints. Fetches fresh CSV before each attempt. Sends one POST per item. Resets on failure.

```bash
npm run remote-experiment
```

## Prompt structure

Every prompt is split into two parts:

```
[static prefix — identical for all 10 items → cached by hub's model]
Answer DNG or NEU only. Reactor or fuel rod items: always NEU. DNG if...

[dynamic suffix — changes per item → not cached]
Item 3: Reactor cooling module
```

Static prefix first, variable data last — this maximises prompt cache hits and reduces cost from `0.02 PP/10 tokens` to `0.01 PP/10 tokens`.

Token limit for the full prompt (prefix + newline + item line) is **100 tokens**, measured locally with `js-tiktoken` before each request.

## LLM prompt engineer

`src/promptEngineer.ts` uses `anthropic/claude-sonnet-4-6` via OpenRouter to refine the prompt after each failed iteration.

Each refinement call sends the **full conversation history** (multi-turn) so the model knows:
- every prefix it already tried
- the exact hub error message for each attempt
- which items failed, what was returned vs expected
- the token breakdown: `prefix=52 + newline=1 + item_line≈34 = 87/100 tokens`

The conversation is saved to `state/engineer_chat_<runId>.json` after each turn so you can inspect how the model learned.

Falls back to rule-based refinement if `OPENROUTER_API_KEY` is missing or the API call fails.

## Session state files

All files are written to `state/` (configurable via `STATE_DIR`):

| File | Contents |
|---|---|
| `session.json` | Current run status and iteration counter |
| `budget_state.json` | Cumulative cost and token counters |
| `best_prompt.json` | Best-scoring prompt candidate so far |
| `trace.jsonl` | Structured runtime trace events |
| `experiments.jsonl` | Per-iteration outcomes and results |
| `engineer_chat_<runId>.json` | Full LLM engineer conversation history |

## Budget

| Token type | Cost |
|---|---|
| 10 input tokens | 0.02 PP |
| 10 cached input tokens | 0.01 PP |
| 10 output tokens | 0.02 PP |

Total budget: **1.5 PP** per run. The harness estimates token cost before each request and blocks it if the budget would be exceeded.

## Install

```bash
npm install
```

## Environment variables

Copy from repo root `.env` or create `02_01_zadanie/.env`:

```env
# Required for REMOTE_EXPERIMENT mode
AI_DEVS_4_KEY=your-key-here

# Required for LLM prompt engineer
OPENROUTER_API_KEY=your-openrouter-key

# Optional
ENGINEER_MODEL=anthropic/claude-sonnet-4-6   # default
MAX_ITERATIONS=8                              # default
TOKEN_LIMIT=100                               # default
BUDGET_LIMIT_PP=1.5                           # default
REQUEST_RETRY_COUNT=3                         # default
REQUEST_RETRY_DELAY_MS=400                    # default
STATE_DIR=state                               # default
```

## S02E01 lesson concepts mapped to code

| Concept | Where |
|---|---|
| Iterative prompt refinement with LLM | `src/promptEngineer.ts` |
| LLM memory via conversation history | `PromptEngineer.history[]` + `engineer_chat_*.json` |
| Reading hub responses for improvement | `buildUserMessage()` — hub errors, raw responses, failed items |
| Token limit enforcement | `src/tokenEstimator.ts` + runner loop |
| Prompt caching (static prefix first) | `renderPrompt()` in `src/prompting.ts` |
| Classification exceptions | reactor/fuel rod → NEU in all prompt candidates |
| State outside context window | JSON/JSONL files in `state/` |
| Budget tracking | `src/budgetManager.ts` |
| Fresh CSV per attempt | `hubClient.fetchFreshCsv()` called each iteration |
