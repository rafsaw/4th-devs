import dotenv from "dotenv";
import { ENV_PATH } from "./paths.js";

dotenv.config({ path: ENV_PATH, quiet: true });

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name} (expected in ${ENV_PATH})`);
  return v;
}

export const AI_DEVS_4_KEY = () => requireEnv("AI_DEVS_4_KEY");
export const GEMINI_API_KEY = () => requireEnv("GEMINI_API_KEY");

/** Optional override: "left,top,width,height" in pixels on the full PNG */
export function gridBBoxOverride(): { left: number; top: number; width: number; height: number } | null {
  const raw = process.env.ELECTRICITY_GRID_BBOX?.trim();
  if (!raw) return null;
  const parts = raw.split(",").map((s) => Number(s.trim()));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) {
    throw new Error("ELECTRICITY_GRID_BBOX must be left,top,width,height");
  }
  const [left, top, width, height] = parts;
  if (width <= 0 || height <= 0) throw new Error("ELECTRICITY_GRID_BBOX width/height must be positive");
  return { left, top, width, height };
}

export function geminiVisionModel(): string {
  return process.env.GEMINI_VISION_MODEL?.trim() || "gemini-2.5-flash";
}

/**
 * How `resolveGridBBox` chooses the crop (unless ELECTRICITY_GRID_BBOX is set).
 * - heuristic: dark-pixel bounding box (no API call)
 * - llm: Gemini describes grid as fractional rect → pixels (one API call per image)
 */
export type GridDetectMethod = "heuristic" | "llm";

export function gridDetectMethod(): GridDetectMethod {
  const raw = process.env.ELECTRICITY_GRID_DETECT?.trim().toLowerCase();
  if (raw === "llm" || raw === "gemini" || raw === "vision") return "llm";
  return "heuristic";
}
