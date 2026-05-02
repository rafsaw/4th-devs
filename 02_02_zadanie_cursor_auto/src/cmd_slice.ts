import fs from "node:fs/promises";
import "./lib/env.js";
import { resolveGridBBox, sliceGridToTiles } from "./lib/grid.js";
import { BOARD_PNG, CURRENT_TILES_DIR, SOLVED_PNG, SOLVED_TILES_DIR } from "./lib/paths.js";

const mode = process.argv[2];

if (mode !== "solved" && mode !== "board") {
  console.error('Usage: npm run slice:solved | npm run slice:board');
  process.exit(1);
}

const input = mode === "solved" ? SOLVED_PNG : BOARD_PNG;
const outDir = mode === "solved" ? SOLVED_TILES_DIR : CURRENT_TILES_DIR;

await fs.access(input).catch(() => {
  throw new Error(
    mode === "board"
      ? `Missing ${input}. Run npm run fetch or npm run reset first.`
      : `Missing ${input}.`
  );
});

const bbox = await resolveGridBBox(input);
const { tiles } = await sliceGridToTiles(input, outDir, bbox);

console.log(`Source: ${input}`);
console.log(`Grid bbox (px): left=${bbox.left} top=${bbox.top} w=${bbox.width} h=${bbox.height}`);
console.log(`Tiles written to ${outDir}`);
for (const [id, p] of Object.entries(tiles)) console.log(`  ${id} -> ${p}`);
