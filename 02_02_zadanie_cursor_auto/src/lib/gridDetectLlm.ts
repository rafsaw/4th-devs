import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { GEMINI_API_KEY, geminiVisionModel } from "./env.js";
import type { BBox } from "./grid.js"; // type-only: avoids runtime cycle with grid.ts
import { DATA_DIR } from "./paths.js";

/** Normalized rectangle: fractions of full image width/height in [0, 1]. */
export type GridBBoxFractions = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const PROMPT = `You are locating the playable 3x3 puzzle grid in this image.

The image shows a central area: nine square cells in a 3x3 layout, framed by thick black lines (wires). Around it there may be title text, icons, or labels (e.g. PWR codes) — ignore those for this task.

Return ONLY valid JSON (no markdown) describing the tight axis-aligned bounding box around the OUTER border of that 3x3 grid (the rectangle that contains all nine cells, including their shared black grid lines).

Use fractions of the full image size, each between 0 and 1:
- "left": distance from the image's left edge to the grid's outer left border, divided by image width
- "top": distance from the image's top edge to the grid's outer top border, divided by image height  
- "width": grid outer width divided by image width
- "height": grid outer height divided by image height

Example shape:
{"left":0.15,"top":0.22,"width":0.5,"height":0.55}

Be precise: the box should tightly wrap the 3x3 wiring frame only.`;

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

export function fractionsToBBox(
  f: GridBBoxFractions,
  imageWidth: number,
  imageHeight: number
): BBox {
  const leftF = clamp01(f.left);
  const topF = clamp01(f.top);
  const wF = clamp01(f.width);
  const hF = clamp01(f.height);

  let left = Math.round(leftF * imageWidth);
  let top = Math.round(topF * imageHeight);
  let width = Math.round(wF * imageWidth);
  let height = Math.round(hF * imageHeight);

  if (left + width > imageWidth) width = imageWidth - left;
  if (top + height > imageHeight) height = imageHeight - top;
  width = Math.max(1, width);
  height = Math.max(1, height);

  return { left, top, width, height };
}

function parseGridJson(text: string): GridBBoxFractions {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error(`No JSON in model output: ${text.slice(0, 200)}`);
  const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;

  const left = Number(raw.left);
  const top = Number(raw.top);
  const width = Number(raw.width);
  const height = Number(raw.height);

  if ([left, top, width, height].some((n) => Number.isNaN(n))) {
    throw new Error("JSON must have numeric left, top, width, height");
  }
  if (width <= 0 || height <= 0) {
    throw new Error("width and height fractions must be positive");
  }
  if (left < 0 || top < 0 || left > 1 || top > 1) {
    throw new Error("left/top must be within [0,1]");
  }

  return { left, top, width, height };
}

export type LlmGridDetectResult = {
  bbox: BBox;
  fractions: GridBBoxFractions;
  imageWidth: number;
  imageHeight: number;
  /** Full text returned by the model (before JSON extraction). */
  rawModelText: string;
  /** Path written by `saveGridLlmResponse`, if saving ran. */
  savedTo?: string;
};

export type DetectGridGeminiOptions = {
  retries?: number;
  /** If false, skip writing JSON to disk. Default true. */
  save?: boolean;
  /** Override output path; default is derived from image basename (see `defaultGridLlmSavePath`). */
  savePath?: string;
};

/** JSON artifact written under `data/` for debugging and reproducibility. */
export type GridLlmSavedPayload = {
  savedAt: string;
  source: string;
  model: string;
  imageWidth: number;
  imageHeight: number;
  rawModelText: string;
  fractions: GridBBoxFractions;
  bboxPixels: BBox;
};

export function defaultGridLlmSavePath(imagePath: string): string {
  const abs = path.resolve(imagePath);
  const base = path.basename(abs).toLowerCase();
  if (base === "board.png") return path.join(DATA_DIR, "grid-detect-board.json");
  if (base === "solved_electricity.png") return path.join(DATA_DIR, "grid-detect-solved.json");
  const stem = path.basename(abs, path.extname(abs)).replace(/[^a-z0-9_-]+/gi, "-");
  return path.join(DATA_DIR, `grid-detect-${stem}.json`);
}

export async function saveGridLlmResponse(
  imagePath: string,
  result: Omit<LlmGridDetectResult, "savedTo">,
  savePath: string
): Promise<void> {
  const payload: GridLlmSavedPayload = {
    savedAt: new Date().toISOString(),
    source: path.resolve(imagePath),
    model: geminiVisionModel(),
    imageWidth: result.imageWidth,
    imageHeight: result.imageHeight,
    rawModelText: result.rawModelText,
    fractions: result.fractions,
    bboxPixels: result.bbox,
  };
  await fsp.mkdir(path.dirname(savePath), { recursive: true });
  await fsp.writeFile(savePath, JSON.stringify(payload, null, 2), "utf8");
}

export async function detectGridBBoxWithGemini(
  imagePath: string,
  options: DetectGridGeminiOptions = {}
): Promise<LlmGridDetectResult> {
  const retries = options.retries ?? 3;
  const shouldSave = options.save !== false;

  const meta = await sharp(imagePath).metadata();
  const iw = meta.width ?? 0;
  const ih = meta.height ?? 0;
  if (!iw || !ih) throw new Error(`Could not read dimensions for ${imagePath}`);

  const model = new GoogleGenerativeAI(GEMINI_API_KEY()).getGenerativeModel({
    model: geminiVisionModel(),
  });

  const imagePart = {
    inlineData: {
      data: Buffer.from(fs.readFileSync(imagePath)).toString("base64"),
      mimeType: "image/png",
    },
  };

  let lastErr: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      const result = await model.generateContent([PROMPT, imagePart]);
      const text = (await result.response).text();
      const fractions = parseGridJson(text);
      const bbox = fractionsToBBox(fractions, iw, ih);
      const out: LlmGridDetectResult = {
        bbox,
        fractions,
        imageWidth: iw,
        imageHeight: ih,
        rawModelText: text,
      };

      if (shouldSave) {
        const savePath = options.savePath ?? defaultGridLlmSavePath(imagePath);
        await saveGridLlmResponse(imagePath, out, savePath);
        out.savedTo = path.resolve(savePath);
        console.error(`Grid LLM response saved: ${out.savedTo}`);
      }

      return out;
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`Grid LLM attempt ${i + 1}/${retries} failed: ${msg}`);
      if (i < retries - 1) await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
