import "./lib/env.js";
import { downloadBoard } from "./lib/hub.js";
import { BOARD_PNG } from "./lib/paths.js";

await downloadBoard(BOARD_PNG, false);
console.log(`Latest board saved: ${BOARD_PNG}`);
