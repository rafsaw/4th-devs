export type Edge = "top" | "right" | "bottom" | "left";

export type TileEdges = {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
};

export type Special = "source" | "plant" | "empty" | "pipe";

export type Tile = TileEdges & {
  special: Special;
  label?: string;
};

export type Row = 1 | 2 | 3;
export type Col = 1 | 2 | 3;

export type FieldId =
  | "1x1" | "1x2" | "1x3"
  | "2x1" | "2x2" | "2x3"
  | "3x1" | "3x2" | "3x3";

export const ALL_FIELDS: FieldId[] = [
  "1x1", "1x2", "1x3",
  "2x1", "2x2", "2x3",
  "3x1", "3x2", "3x3",
];

export type BoardState = Record<FieldId, Tile>;

export function fieldId(row: Row, col: Col): FieldId {
  return `${row}x${col}` as FieldId;
}

export function parseField(id: FieldId): { row: Row; col: Col } {
  const [r, c] = id.split("x").map(Number) as [Row, Col];
  return { row: r, col: c };
}

/**
 * Rotate edges 90 degrees clockwise (right rotation).
 * Mapping after one CW rotation:
 *   top    -> right
 *   right  -> bottom
 *   bottom -> left
 *   left   -> top
 */
export function rotateRight(t: TileEdges, times = 1): TileEdges {
  let cur = { ...t };
  for (let i = 0; i < ((times % 4) + 4) % 4; i++) {
    cur = {
      top: cur.left,
      right: cur.top,
      bottom: cur.right,
      left: cur.bottom,
    };
  }
  return cur;
}

export function edgesEqual(a: TileEdges, b: TileEdges): boolean {
  return a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;
}

/**
 * Returns the minimum number of clockwise 90-degree rotations (0..3)
 * needed to transform `from` into `to`. Returns null if impossible
 * (different number/positions of edges that can't be rotated to match).
 */
export function rotationsNeeded(from: TileEdges, to: TileEdges): number | null {
  for (let r = 0; r < 4; r++) {
    if (edgesEqual(rotateRight(from, r), to)) return r;
  }
  return null;
}
