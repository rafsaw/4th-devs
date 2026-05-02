import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Project root: 02_02_zadanie_cursor_auto */
export const PROJECT_ROOT = path.join(__dirname, "..", "..");

/** Repo root: 4th-devs (parent of project folder) */
export const REPO_ROOT = path.join(PROJECT_ROOT, "..");

export const ENV_PATH = path.join(REPO_ROOT, ".env");

export const DATA_DIR = path.join(PROJECT_ROOT, "data");
export const BOARD_PNG = path.join(DATA_DIR, "board.png");
export const SOLVED_PNG = path.join(PROJECT_ROOT, "solved_electricity.png");
export const SOLVED_TILES_DIR = path.join(DATA_DIR, "solved", "tiles");
export const CURRENT_TILES_DIR = path.join(DATA_DIR, "current", "tiles");
export const VISION_DIR = path.join(DATA_DIR, "vision");
