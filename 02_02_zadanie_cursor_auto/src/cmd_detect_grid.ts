import fs from "node:fs/promises";
import path from "node:path";
import "./lib/env.js";
import { detectGridBBoxWithGemini } from "./lib/gridDetectLlm.js";
import { BOARD_PNG, DATA_DIR, SOLVED_PNG } from "./lib/paths.js";

const mode = process.argv[2];

if (mode !== "solved" && mode !== "board") {
  console.error("Usage: npm run detect-grid -- solved | board");
  console.error("Calls Gemini once to estimate the 3x3 grid box as fractions, then pixels.");
  process.exit(1);
}

const input = mode === "solved" ? SOLVED_PNG : BOARD_PNG;
await fs.access(input).catch(() => {
  throw new Error(
    mode === "board"
      ? `Missing ${input}. Run npm run fetch or npm run reset first.`
      : `Missing ${input}.`
  );
});

const outName = mode === "solved" ? "grid-detect-solved.json" : "grid-detect-board.json";
const outPath = path.join(DATA_DIR, outName);

const result = await detectGridBBoxWithGemini(input, { savePath: outPath });

const forStdout = {
  source: path.resolve(input),
  savedTo: result.savedTo,
  imageWidth: result.imageWidth,
  imageHeight: result.imageHeight,
  rawModelText: result.rawModelText,
  fractions: result.fractions,
  bboxPixels: result.bbox,
};

console.log(JSON.stringify(forStdout, null, 2));

console.error(
  "Tip: set ELECTRICITY_GRID_DETECT=llm before slice, or paste bbox into ELECTRICITY_GRID_BBOX=left,top,width,height"
);
