import fs from "node:fs/promises";
import path from "node:path";
import "./lib/env.js";
import { describeTilePair } from "./lib/gemini.js";
import { allTileIds, isTileId } from "./lib/grid.js";
import { CURRENT_TILES_DIR, SOLVED_TILES_DIR, VISION_DIR } from "./lib/paths.js";

const arg = process.argv[2];

async function runOne(tile: string): Promise<void> {
  if (!isTileId(tile)) {
    console.error(`Invalid tile "${tile}". Use e.g. 2x3`);
    process.exit(1);
  }
  const cur = path.join(CURRENT_TILES_DIR, `${tile}.png`);
  const tgt = path.join(SOLVED_TILES_DIR, `${tile}.png`);
  await fs.access(cur).catch(() => {
    throw new Error(`Missing ${cur} — run npm run slice:board`);
  });
  await fs.access(tgt).catch(() => {
    throw new Error(`Missing ${tgt} — run npm run slice:solved`);
  });

  const comparison = await describeTilePair(cur, tgt);
  console.log(JSON.stringify({ tile, comparison }, null, 2));

  await fs.mkdir(VISION_DIR, { recursive: true });
  const outPath = path.join(VISION_DIR, `${tile}.json`);
  await fs.writeFile(outPath, JSON.stringify({ tile, comparison }, null, 2), "utf8");
  console.log(`Saved ${outPath}`);
}

async function runAll(): Promise<void> {
  const results: { tile: string; comparison: Awaited<ReturnType<typeof describeTilePair>> }[] =
    [];
  for (const tile of allTileIds()) {
    process.stdout.write(`${tile}... `);
    const cur = path.join(CURRENT_TILES_DIR, `${tile}.png`);
    const tgt = path.join(SOLVED_TILES_DIR, `${tile}.png`);
    const comparison = await describeTilePair(cur, tgt);
    results.push({ tile, comparison });
    console.log("ok");
  }
  await fs.mkdir(VISION_DIR, { recursive: true });
  const allPath = path.join(VISION_DIR, "all-tiles.json");
  await fs.writeFile(allPath, JSON.stringify(results, null, 2), "utf8");
  console.log(`Wrote ${allPath}`);
}

if (arg === "all") {
  await runAll();
} else if (arg) {
  await runOne(arg);
} else {
  console.error("Usage: npm run vision:tile -- 2x3   OR   npm run vision:all");
  process.exit(1);
}
