import "./lib/env.js";
import { rotateTile } from "./lib/hub.js";
import { isTileId } from "./lib/grid.js";

const tile = process.argv[2];
if (!tile || !isTileId(tile)) {
  console.error('Usage: npm run rotate -- 2x3');
  process.exit(1);
}

const res = await rotateTile(tile);
console.log(JSON.stringify(res, null, 2));
