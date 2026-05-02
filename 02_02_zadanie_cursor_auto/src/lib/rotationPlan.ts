import type { Edge, TileComparison } from "./gemini.js";
import type { TileId } from "./grid.js";

const ORDER: Edge[] = ["top", "right", "bottom", "left"];

function normEdges(edges: string[]): Set<Edge> {
  const s = new Set<Edge>();
  for (const e of edges) {
    if (e === "top" || e === "right" || e === "bottom" || e === "left") s.add(e);
  }
  return s;
}

/** Right rotation: top->right->bottom->left->top */
function rotateEdgesRight(edges: Set<Edge>): Set<Edge> {
  const next = new Set<Edge>();
  for (const e of edges) {
    const i = ORDER.indexOf(e);
    next.add(ORDER[(i + 1) % 4]!);
  }
  return next;
}

function setsEqual(a: Set<Edge>, b: Set<Edge>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/**
 * Number of 90° right rotations to apply to CURRENT so its edge set matches TARGET.
 * Returns null if no k in 0..3 works (vision mismatch or invalid inputs).
 */
export function rightRotationsNeeded(comparison: TileComparison): number | null {
  let cur = normEdges(comparison.current);
  const goal = normEdges(comparison.target);
  for (let k = 0; k < 4; k++) {
    if (setsEqual(cur, goal)) return k;
    cur = rotateEdgesRight(cur);
  }
  return null;
}

export type PlannedRotate = { tile: TileId; rightTurns: number };

export function planFromComparisons(
  entries: { tile: TileId; comparison: TileComparison }[]
): { plan: PlannedRotate[]; errors: { tile: TileId; reason: string }[] } {
  const plan: PlannedRotate[] = [];
  const errors: { tile: TileId; reason: string }[] = [];

  for (const { tile, comparison } of entries) {
    const cur = normEdges(comparison.current);
    const tgt = normEdges(comparison.target);
    if (cur.size !== tgt.size) {
      errors.push({
        tile,
        reason: `edge count mismatch current=${cur.size} target=${tgt.size} (re-run vision or fix JSON)`,
      });
      continue;
    }
    const k = rightRotationsNeeded(comparison);
    if (k === null) {
      errors.push({
        tile,
        reason: "current/target edge sets not related by rotation (check vision JSON)",
      });
      continue;
    }
    if (k > 0) plan.push({ tile, rightTurns: k });
  }

  return { plan, errors };
}
