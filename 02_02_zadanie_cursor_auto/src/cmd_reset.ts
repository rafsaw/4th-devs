import "./lib/env.js";
import { wipeDataDirectory } from "./lib/dataWipe.js";
import { downloadBoard } from "./lib/hub.js";
import { BOARD_PNG, DATA_DIR } from "./lib/paths.js";

await wipeDataDirectory();
console.error(`Wiped ${DATA_DIR} (only .gitkeep remains until board download)`);

await downloadBoard(BOARD_PNG, true);
console.log(`Reset board saved: ${BOARD_PNG}`);
