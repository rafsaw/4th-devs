import fsp from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "./paths.js";

/** Deletes `data/` and everything under it, then recreates the folder with `.gitkeep`. */
export async function wipeDataDirectory(): Promise<void> {
  await fsp.rm(DATA_DIR, { recursive: true, force: true });
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.writeFile(path.join(DATA_DIR, ".gitkeep"), "\n", "utf8");
}
