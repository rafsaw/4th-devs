import fs from "node:fs/promises";
import path from "node:path";
import "./lib/env.js";
import type { TileComparison } from "./lib/gemini.js";
import { isTileId, type TileId } from "./lib/grid.js";
import { planFromComparisons } from "./lib/rotationPlan.js";
import { VISION_DIR } from "./lib/paths.js";

type AllTilesFile = { tile: string; comparison: TileComparison }[];

async function loadComparisons(): Promise<{ tile: TileId; comparison: TileComparison }[]> {
  const allPath = path.join(VISION_DIR, "all-tiles.json");
  const raw = await fs.readFile(allPath, "utf8").catch(() => {
    throw new Error(
      `Missing ${allPath}. Run: npm run vision:all   (plan needs all 9 tiles in one file)`
    );
  });
  const data = JSON.parse(raw) as AllTilesFile;
  const out: { tile: TileId; comparison: TileComparison }[] = [];
  for (const row of data) {
    if (!isTileId(row.tile)) continue;
    out.push({ tile: row.tile, comparison: row.comparison });
  }
  if (out.length !== 9) {
    throw new Error(`Expected 9 tiles in ${allPath}, got ${out.length}`);
  }
  return out;
}

const entries = await loadComparisons();
const { plan, errors } = planFromComparisons(entries);

if (errors.length) {
  console.error("Issues:");
  for (const e of errors) console.error(`  ${e.tile}: ${e.reason}`);
}

console.log("Planned API rotations (each line = one POST /verify):");
for (const { tile, rightTurns } of plan) {
  for (let i = 0; i < rightTurns; i++) console.log(`  ${tile}`);
}

if (!plan.length && !errors.length) {
  console.log("  (none — board already matches target orientation per vision)");
}
