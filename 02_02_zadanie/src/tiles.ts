import sharp from "sharp";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { FieldId } from "./types.js";
import { ALL_FIELDS } from "./types.js";

export type GridBox = { x: number; y: number; w: number; h: number };

/**
 * Detect the bounding box of the 3x3 grid inside an image.
 *
 * Heuristic: longest continuous dark-pixel run.
 *  - Convert to grayscale (dark = gray < 100).
 *  - For each row, compute the longest CONTINUOUS run of dark pixels.
 *    A grid horizontal border is one solid line, so its run length ≈ grid width.
 *  - Title text and labels have short strokes per row → small max run.
 *  - Same logic for columns.
 *  - Bounding box = first/last row (column) where max run exceeds 25% of image span.
 *
 * Restrict scans to a central band of the orthogonal axis to ignore
 * outer icons/labels.
 */
export async function detectGridBox(buf: Buffer): Promise<GridBox> {
  const override = process.env.GRID_BOX;
  if (override) {
    const [x, y, w, h] = override.split(",").map((s) => Number(s.trim()));
    if ([x, y, w, h].every((n) => Number.isFinite(n))) return { x, y, w, h };
  }

  const meta = await sharp(buf).metadata();
  const W = meta.width!;
  const H = meta.height!;

  const { data } = await sharp(buf)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const isDark = (x: number, y: number) => data[y * W + x] < 100;

  const yLo = Math.floor(H * 0.05);
  const yHi = Math.floor(H * 0.95);
  const xLo = Math.floor(W * 0.15);
  const xHi = Math.floor(W * 0.85);

  // Longest dark run per row (within central column band).
  const rowMaxRun = new Array<number>(H).fill(0);
  for (let y = 0; y < H; y++) {
    let cur = 0;
    let maxRun = 0;
    for (let x = xLo; x < xHi; x++) {
      if (isDark(x, y)) {
        cur++;
        if (cur > maxRun) maxRun = cur;
      } else {
        cur = 0;
      }
    }
    rowMaxRun[y] = maxRun;
  }

  // Longest dark run per column (within central row band).
  const colMaxRun = new Array<number>(W).fill(0);
  for (let x = 0; x < W; x++) {
    let cur = 0;
    let maxRun = 0;
    for (let y = yLo; y < yHi; y++) {
      if (isDark(x, y)) {
        cur++;
        if (cur > maxRun) maxRun = cur;
      } else {
        cur = 0;
      }
    }
    colMaxRun[x] = maxRun;
  }

  // Threshold: a true grid border is a single uninterrupted line spanning
  // most of the grid width/height. Use 25% of the orthogonal scan span;
  // text and icon strokes are typically much shorter.
  const rowThr = Math.max(40, (xHi - xLo) * 0.25);
  const colThr = Math.max(40, (yHi - yLo) * 0.25);

  let yTop = -1;
  let yBot = -1;
  for (let y = 0; y < H; y++) {
    if (rowMaxRun[y] > rowThr) {
      if (yTop === -1) yTop = y;
      yBot = y;
    }
  }

  let xLeft = -1;
  let xRight = -1;
  for (let x = 0; x < W; x++) {
    if (colMaxRun[x] > colThr) {
      if (xLeft === -1) xLeft = x;
      xRight = x;
    }
  }

  if (xLeft < 0 || yTop < 0 || xRight - xLeft < 30 || yBot - yTop < 30) {
    throw new Error(
      `Grid box detection failed (xLeft=${xLeft} xRight=${xRight} yTop=${yTop} yBot=${yBot}). ` +
      `Try setting env GRID_BOX="x,y,w,h" manually.`,
    );
  }

  return { x: xLeft, y: yTop, w: xRight - xLeft + 1, h: yBot - yTop + 1 };
}

/**
 * Split a board PNG into 9 tile PNGs (PNG buffers), keyed by FieldId.
 *
 * @param buf source image buffer
 * @param padding fraction of tile side to crop inwards on each side
 *                (helps the vision model focus on the cable, not the borders).
 *                Default 0.08 = 8% pad each side.
 */
export async function splitInto9Tiles(
  buf: Buffer,
  padding = 0.08,
): Promise<{ tiles: Record<FieldId, Buffer>; gridBox: GridBox }> {
  const gridBox = await detectGridBox(buf);
  const tileW = gridBox.w / 3;
  const tileH = gridBox.h / 3;

  const out = {} as Record<FieldId, Buffer>;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const fid = ALL_FIELDS[r * 3 + c];
      const padX = Math.floor(tileW * padding);
      const padY = Math.floor(tileH * padding);
      const left = Math.round(gridBox.x + c * tileW + padX);
      const top = Math.round(gridBox.y + r * tileH + padY);
      const width = Math.max(8, Math.round(tileW - 2 * padX));
      const height = Math.max(8, Math.round(tileH - 2 * padY));
      out[fid] = await sharp(buf)
        .extract({ left, top, width, height })
        .png()
        .toBuffer();
    }
  }
  return { tiles: out, gridBox };
}

/**
 * Optionally write the 9 tiles into a folder for debugging.
 * Triggered when env DEBUG_TILES_DIR is set, or when explicitly requested.
 */
export async function debugDumpTiles(
  tiles: Record<FieldId, Buffer>,
  dir: string,
  prefix = "tile",
): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  for (const fid of ALL_FIELDS) {
    const filename = `${prefix}_${fid}.png`;
    await fs.writeFile(path.join(dir, filename), tiles[fid]);
  }
}

export function hashBuffer(buf: Buffer): string {
  // FNV-1a 32-bit, simple and fast for cache keys.
  let h = 0x811c9dc5;
  for (let i = 0; i < buf.length; i++) {
    h ^= buf[i];
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0") + "-" + buf.length.toString(16);
}
