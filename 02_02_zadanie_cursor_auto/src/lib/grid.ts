import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { gridBBoxOverride, gridDetectMethod, type GridDetectMethod } from "./env.js";
import { detectGridBBoxWithGemini } from "./gridDetectLlm.js";

export type BBox = { left: number; top: number; width: number; height: number };

function lumaAt(data: Buffer, stride: number, idx: number): number {
  const o = idx * stride;
  return 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
}

/**
 * Finds a tight bbox around very dark pixels (grid strokes). This excludes the
 * beige background, title, and most non-grid art that is lighter than ink.
 */
export async function detectGridBBox(
  imagePath: string,
  lumaThreshold = 40
): Promise<BBox> {
  const { data, info } = await sharp(imagePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  const stride = info.channels;
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  let any = false;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const L = lumaAt(data, stride, y * w + x);
      if (L < lumaThreshold) {
        any = true;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (!any) {
    throw new Error(
      `No dark pixels under threshold ${lumaThreshold} — try ELECTRICITY_GRID_BBOX or lower threshold`
    );
  }

  return {
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

export type ResolveGridOptions = {
  /** Overrides ELECTRICITY_GRID_DETECT for this call */
  method?: GridDetectMethod;
};

export async function resolveGridBBox(
  imagePath: string,
  options?: ResolveGridOptions
): Promise<BBox> {
  const override = gridBBoxOverride();
  if (override) return override;

  const method = options?.method ?? gridDetectMethod();
  if (method === "llm") {
    const { bbox } = await detectGridBBoxWithGemini(imagePath);
    return bbox;
  }
  return detectGridBBox(imagePath);
}

const TILE_IDS = ["1x1", "1x2", "1x3", "2x1", "2x2", "2x3", "3x1", "3x2", "3x3"] as const;

export type TileId = (typeof TILE_IDS)[number];

export function isTileId(s: string): s is TileId {
  return (TILE_IDS as readonly string[]).includes(s);
}

export async function sliceGridToTiles(
  imagePath: string,
  outDir: string,
  bbox?: BBox
): Promise<{ bbox: BBox; tiles: Record<TileId, string> }> {
  const box = bbox ?? (await resolveGridBBox(imagePath));
  await fs.mkdir(outDir, { recursive: true });

  const tileW = Math.floor(box.width / 3);
  const tileH = Math.floor(box.height / 3);
  const tiles = {} as Record<TileId, string>;

  let idx = 0;
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const id = TILE_IDS[idx++]!;
      const left = box.left + col * tileW;
      const top = box.top + row * tileH;
      const width = col === 2 ? box.width - col * tileW : tileW;
      const height = row === 2 ? box.height - row * tileH : tileH;
      const outPath = path.join(outDir, `${id}.png`);
      await sharp(imagePath)
        .extract({ left, top, width, height })
        .png()
        .toFile(outPath);
      tiles[id] = outPath;
    }
  }

  return { bbox: box, tiles };
}

export function allTileIds(): TileId[] {
  return [...TILE_IDS];
}
