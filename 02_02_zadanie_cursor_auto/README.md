# Electricity puzzle — step-by-step CLI (AI Devs 4)

Manual workflow: pull the board from the hub, locate the **inner 3×3 grid** (heuristic or Gemini), cut nine tiles, use **Gemini** to compare each cell to the solved reference, compute right rotations, then call the hub (`POST /verify`) one rotation at a time.

## Prerequisites

- **Node.js** 20+ (LTS recommended). `sharp` uses native binaries; use a [supported Node version](https://sharp.pixelplumbing.com/install#cross-platform) for your OS.
- **npm** (bundled with Node).

## First-time setup

This package path: **`4th-devs/02_02_zadanie_cursor_auto/`**.

```bash
cd 02_02_zadanie_cursor_auto
npm install
```

Install is required after clone or when `package.json` changes. Scripts run **`tsx`** from `node_modules`; no global `tsx` install needed.

### Environment variables

Loaded from the **repository root** file **`4th-devs/.env`** (not from this folder). The code resolves `../.env` relative to this project.

| Variable | Required | Role |
|----------|----------|------|
| `AI_DEVS_4_KEY` | Yes | Hub: `GET …/data/<key>/electricity.png` and `POST https://hub.ag3nts.org/verify`. |
| `GEMINI_API_KEY` | Yes* | Gemini for `detect-grid`, LLM grid mode in `slice`, and `vision:*`. |
| `GEMINI_VISION_MODEL` | No | Default `gemini-2.5-flash`. |
| `ELECTRICITY_GRID_DETECT` | No | If unset or anything other than below → **heuristic** (dark-pixel bbox, no API). Set to **`llm`**, **`gemini`**, or **`vision`** → Gemini returns fractional bbox; converted to pixels per image. |
| `ELECTRICITY_GRID_BBOX` | No | **`left,top,width,height`** in pixels on the full PNG. If set, **wins** — no heuristic and no grid LLM. |

\*Not needed only if you never run Gemini (heuristic slice + no `detect-grid` / no `vision`); this project expects Gemini for tile comparison.

## Commands

Run all **`npm run …`** scripts from **`02_02_zadanie_cursor_auto`**.

On **Windows (PowerShell)**, pass **`--`** before arguments so npm forwards them (e.g. `npm run vision:tile -- 2x3`).

### Hub

| Command | Description |
|---------|-------------|
| `npm run reset` | **Deletes the entire `data/` tree** (tiles, vision JSON, grid JSON, old `board.png`), recreates `data/` with **`data/.gitkeep`**, then downloads a **new** puzzle: `GET …/electricity.png?reset=1` → **`data/board.png`**. |
| `npm run fetch` | Latest board (no reset) → **`data/board.png`** (does **not** wipe `data/`). |

### Grid detection (Gemini, optional standalone)

Full image is sent once; the model returns JSON **`left` / `top` / `width` / `height`** as **fractions of image size** (0…1). That is saved (with **`rawModelText`**) and can be inspected without running `slice`.

| Command | Description |
|---------|-------------|
| `npm run detect-grid -- solved` | Input: **`solved_electricity.png`**. Writes **`data/grid-detect-solved.json`**, prints summary to stdout. |
| `npm run detect-grid -- board` | Input: **`data/board.png`**. Writes **`data/grid-detect-board.json`**. |

### Slicing (3×3 tiles)

| Command | Input | Output |
|---------|--------|--------|
| `npm run slice:solved` | `solved_electricity.png` | **`data/solved/tiles/1x1.png`** … **`3x3.png`** |
| `npm run slice:board` | `data/board.png` | **`data/current/tiles/*.png`** |

**How the crop rectangle is chosen** (in `resolveGridBBox` → `cmd_slice.ts`):

1. **`ELECTRICITY_GRID_BBOX`** if set → use those pixels.
2. Else if **`ELECTRICITY_GRID_DETECT`** is **`llm`** / **`gemini`** / **`vision`** → **`detectGridBBoxWithGemini`** (one API call per `slice` run; response saved under **`data/grid-detect-*.json`** when saving is enabled).
3. Else → **heuristic**: bounding box of very dark pixels (`src/lib/grid.ts`).

So **`slice:board` does not call Gemini by default**; set **`ELECTRICITY_GRID_DETECT=llm`** in `.env` (or the shell) to use the LLM path for both `slice:solved` and `slice:board`.

### Vision (per-tile Gemini)

| Command | Description |
|---------|-------------|
| `npm run vision:tile -- 2x3` | Compares **`data/current/tiles/2x3.png`** vs **`data/solved/tiles/2x3.png`**. Writes **`data/vision/2x3.json`**. |
| `npm run vision:all` | All nine tiles → **`data/vision/all-tiles.json`** (needed for **`plan`**). |

### Plan and rotate

| Command | Description |
|---------|-------------|
| `npm run plan` | Reads **`data/vision/all-tiles.json`**, prints **one tile id per line** — each line is one **`POST /verify`** (90° right). |
| `npm run rotate -- 2x3` | Single rotation for tile **`2x3`**. |

### Help

| Command | Description |
|---------|-------------|
| `npm run help` | Short ordered checklist (same ideas as this README). |

## Typical workflow

1. **`npm run reset`** or **`npm run fetch`**
2. **`npm run slice:solved`** (after any change to **`solved_electricity.png`**)
3. **`npm run slice:board`**
4. Optional: **`npm run detect-grid -- board`** to inspect LLM grid output only; or rely on **`ELECTRICITY_GRID_DETECT=llm`** so **`slice`** runs grid Gemini internally.
5. **`npm run vision:tile -- 1x1`** (learning) **or** **`npm run vision:all`**
6. **`npm run plan`**
7. For each line from **`plan`**, run **`npm run rotate -- <tile>`** that many times (repeated id = multiple requests).
8. **`npm run fetch`**, **`npm run slice:board`**, re-check tiles / vision / plan / rotate until the hub returns **`{FLG:...}`**.

## Generated artifacts (`data/`)

| Path | Meaning |
|------|---------|
| `board.png` | Last downloaded puzzle image. |
| `grid-detect-solved.json`, `grid-detect-board.json` | From **`detect-grid`** or from **`slice`** when grid mode is LLM. Fields include **`rawModelText`**, **`fractions`**, **`bboxPixels`**, **`savedAt`**, **`model`**, **`source`**. |
| `solved/tiles/`, `current/tiles/` | Nine PNGs after slice. |
| `vision/*.json` | Tile comparisons; **`all-tiles.json`** required for **`plan`**. |

Contents of **`data/`** are gitignored (except **`data/.gitkeep`**).

## Troubleshooting

- **`npm run reset` deleted my tiles / vision JSON** — by design; use **`fetch`** if you only want a new **`board.png`** without wiping **`data/`**.
- **Missing keys** — confirm **`4th-devs/.env`** and run commands from this package directory.
- **Missing `data/board.png`** — run **`fetch`** or **`reset`** before **`slice:board`**.
- **Bad crops** — inspect **`grid-detect-*.json`**; try **`ELECTRICITY_GRID_DETECT=llm`**, or copy **`bboxPixels`** into **`ELECTRICITY_GRID_BBOX`**; or tune heuristic **`lumaThreshold`** in **`src/lib/grid.ts`**.
- **`plan` missing file** — run **`npm run vision:all`** first.

## Source layout

| Path | Role |
|------|------|
| `src/cmd_*.ts` | One entrypoint per npm script. |
| `src/lib/env.ts` | Loads `.env`, **`ELECTRICITY_GRID_*`**, **`GEMINI_*`**. |
| `src/lib/paths.ts` | **`DATA_DIR`**, **`BOARD_PNG`**, tile dirs. |
| `src/lib/dataWipe.ts` | **`wipeDataDirectory`** — used by **`reset`**. |
| `src/lib/hub.ts` | Download board, **`rotateTile`**. |
| `src/lib/grid.ts` | **`resolveGridBBox`**, heuristic **`detectGridBBox`**, **`sliceGridToTiles`**. |
| `src/lib/gridDetectLlm.ts` | **`detectGridBBoxWithGemini`**, save **`rawModelText`** + parsed bbox. |
| `src/lib/gemini.ts` | Per-tile vision prompt. |
| `src/lib/rotationPlan.ts` | Edge sets → number of right rotations (0–3). |

## Tech stack

TypeScript (ESM), **`tsx`**, **`sharp`**, **`@google/generative-ai`**, **`dotenv`**.
