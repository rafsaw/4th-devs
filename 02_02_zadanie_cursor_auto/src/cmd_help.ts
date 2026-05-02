console.log(`
Electricity puzzle — manual steps (run from 02_02_zadanie_cursor_auto)

Secrets: repo root .env (AI_DEVS_4_KEY, GEMINI_API_KEY)
Optional: GEMINI_VISION_MODEL (default gemini-2.5-flash)
Optional: ELECTRICITY_GRID_DETECT=llm — use Gemini to find grid box (fractions→pixels); default is heuristic (dark pixels)
Optional: ELECTRICITY_GRID_BBOX=left,top,width,height — hard override in pixels (wins over both)

1) npm run reset          — wipe data/ (all subfolders), then GET board with ?reset=1 → data/board.png
2) npm run fetch          — GET latest board → data/board.png
3) npm run detect-grid -- solved | board — Gemini: grid rectangle as JSON + data/grid-detect-*.json (inspect / learn)
4) npm run slice:solved   — crop grid from solved_electricity.png → data/solved/tiles/*.png
5) npm run slice:board    — crop grid from data/board.png → data/current/tiles/*.png
6) npm run vision:tile -- 2x3   — Gemini: one tile current vs solved → data/vision/2x3.json
   npm run vision:all    — all 9 tiles → data/vision/all-tiles.json
7) npm run plan           — read all-tiles.json, print list of rotate commands (geometry)
8) npm run rotate -- 2x3  — POST one 90° right rotation for tile 2x3

Typical loop after edits on hub:
  fetch → slice:board → vision (tile or all) → plan → rotate (per line) → fetch … until {FLG:...}
`);
