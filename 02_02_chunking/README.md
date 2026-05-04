# 02_02_chunking

Four text chunking strategies compared side-by-side.

## Run

All four strategies (from repo root):

```bash
npm run lesson7:chunking
```

Topics only — one LLM call, skips characters, separators, and context (useful when debugging timeouts or token use). Use the dedicated npm script; **do not** use `npm run lesson7:chunking -- --topics` — current npm versions treat `--topics` as an npm CLI flag (`Unknown cli config "--topics"`), so it is not passed to Node and the full four-strategy run starts instead.

```bash
npm run lesson7:chunking:topics
```

From the repo root (same as the script above):

```bash
node ./02_02_chunking/app.js --topics
```

From `02_02_chunking/`:

```bash
node app.js --topics
```

## Required setup

1. Copy `env.example` to `.env` in the repo root.
2. Set one Responses API key: `OPENAI_API_KEY` or `OPENROUTER_API_KEY` (needed for context-enriched and topic-based strategies).

## What it does

1. Reads the source file configured in `app.js` as `INPUT_REL` (resolved from the lesson folder so the app can be run from the repo root or from `02_02_chunking/`)
2. Runs four chunking strategies on the same text:
   - **Characters** — fixed-size windows with overlap
   - **Separators** — splits on headings and paragraph boundaries
   - **Context** — separator-based chunks enriched with an LLM-generated context prefix
   - **Topics** — LLM identifies logical topic boundaries and groups text accordingly
3. Saves each result as JSONL in `workspace/example-[strategy].jsonl`

## Notes

The character and separator strategies are purely local. The context and topic strategies call the LLM, so they consume tokens. Pre-generated outputs are already present in `workspace/`.
