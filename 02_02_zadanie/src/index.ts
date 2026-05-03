import dotenv from "dotenv";
import { promises as fs } from "node:fs";
import path from "node:path";

// Load .env from repo root first (where AI_DEVS_4_KEY etc. live), then local
// .env (overrides if present).
dotenv.config({ path: path.resolve(process.cwd(), "..", ".env") });
dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: true });

import { runAgent } from "./agent.js";
import { resetBoard, fetchCurrentBoardImage } from "./hub.js";
import { detectGridBox, debugDumpTiles, splitInto9Tiles } from "./tiles.js";
import { classifyBoard } from "./vision.js";
import { renderBoard } from "./visualize.js";

const args = process.argv.slice(2);

async function main() {
  if (args.includes("--reset-only")) {
    console.log("Resetuję planszę…");
    await resetBoard();
    console.log("Gotowe.");
    return;
  }

  if (args.includes("--detect-grid")) {
    const target = args.includes("--current") ? "current" : "target";
    let buf: Buffer;
    if (target === "current") {
      console.log("Pobieram electricity.png z huba…");
      buf = await fetchCurrentBoardImage();
    } else {
      const SOLVED_PATH =
        process.env.SOLVED_PATH ??
        path.resolve(process.cwd(), "solved_electricity.png");
      console.log(`Wczytuję ${SOLVED_PATH}…`);
      buf = await fs.readFile(SOLVED_PATH);
    }
    const box = await detectGridBox(buf);
    console.log(`Wykryty grid box: x=${box.x}, y=${box.y}, w=${box.w}, h=${box.h}`);
    const { tiles } = await splitInto9Tiles(buf);
    const dir = process.env.DEBUG_TILES_DIR ?? path.resolve(process.cwd(), `.cache/tiles_${target}`);
    await debugDumpTiles(tiles, dir, target);
    console.log(`Zapisano 9 kafelków do ${dir}`);
    console.log("Bez wywołań LLM. Otwórz pliki ${target}_RxC.png żeby ocenić poprawność cięcia.");
    return;
  }

  if (args.includes("--dump-target")) {
    const SOLVED_PATH =
      process.env.SOLVED_PATH ??
      path.resolve(process.cwd(), "solved_electricity.png");
    console.log(`Wczytuję ${SOLVED_PATH}…`);
    const buf = await fs.readFile(SOLVED_PATH);
    const box = await detectGridBox(buf);
    console.log(`Grid box: ${JSON.stringify(box)}`);
    const { tiles } = await splitInto9Tiles(buf);
    const dir = process.env.DEBUG_TILES_DIR ?? path.resolve(process.cwd(), ".cache/tiles_target");
    await debugDumpTiles(tiles, dir, "target");
    console.log(`Zapisano kafelki do ${dir}`);
    console.log("Klasyfikuję przez vision…");
    const board = await classifyBoard(tiles);
    console.log(renderBoard(board, "STAN DOCELOWY"));
    return;
  }

  if (args.includes("--dump-current")) {
    console.log("Pobieram electricity.png z huba…");
    const buf = await fetchCurrentBoardImage();
    const box = await detectGridBox(buf);
    console.log(`Grid box: ${JSON.stringify(box)}`);
    const { tiles } = await splitInto9Tiles(buf);
    const dir = process.env.DEBUG_TILES_DIR ?? path.resolve(process.cwd(), ".cache/tiles_current");
    await debugDumpTiles(tiles, dir, "current");
    console.log(`Zapisano kafelki do ${dir}`);
    console.log("Klasyfikuję przez vision…");
    const board = await classifyBoard(tiles);
    console.log(renderBoard(board, "STAN BIEŻĄCY"));
    return;
  }

  const flagPath = process.env.FLAG_PATH ?? path.resolve(process.cwd(), "flag.txt");

  console.log("=== AI Devs 4 / S02E02 / electricity ===");
  console.log(`Agent model:  ${process.env.AGENT_MODEL ?? "google/gemini-3-flash-preview"}`);
  console.log(`Vision model: ${process.env.VISION_MODEL ?? "google/gemini-3-flash-preview"}`);
  console.log(`Plik flagi:   ${flagPath} (append-only, znacznik czasu + źródło)`);

  const result = await runAgent();
  console.log("\n=== KONIEC ===");
  console.log(`Iteracje: ${result.iterations}`);
  if (result.flag) {
    console.log(`✓ FLAGA: ${result.flag}`);
    console.log(`(zapisano do ${flagPath})`);
    process.exit(0);
  } else {
    console.log("✗ Brak flagi - sprawdź log powyżej.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(2);
});
