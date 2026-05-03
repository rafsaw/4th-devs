import type { BoardState, FieldId, Tile, TileEdges } from "./types.js";
import { ALL_FIELDS, edgesEqual, rotationsNeeded } from "./types.js";

/**
 * Bitmask: top=1, right=2, bottom=4, left=8.
 * Maps each combination to a Unicode box-drawing character.
 */
const EDGES_TO_GLYPH: Record<number, string> = {
  0b0000: " ",
  0b0001: "╵",
  0b0010: "╶",
  0b0011: "└",
  0b0100: "╷",
  0b0101: "│",
  0b0110: "┌",
  0b0111: "├",
  0b1000: "╴",
  0b1001: "┘",
  0b1010: "─",
  0b1011: "┴",
  0b1100: "┐",
  0b1101: "┤",
  0b1110: "┬",
  0b1111: "┼",
};

export function tileGlyph(t: TileEdges): string {
  const mask =
    (t.top ? 0b0001 : 0) |
    (t.right ? 0b0010 : 0) |
    (t.bottom ? 0b0100 : 0) |
    (t.left ? 0b1000 : 0);
  return EDGES_TO_GLYPH[mask] ?? "?";
}

export function tileEdgesToText(t: TileEdges): string {
  const parts: string[] = [];
  if (t.top) parts.push("↑");
  if (t.right) parts.push("→");
  if (t.bottom) parts.push("↓");
  if (t.left) parts.push("←");
  return parts.length ? parts.join("") : "·";
}

/**
 * Render a 3x3 board as a Unicode box drawing, with each cell being
 * a 5x3 character region containing the connection glyph and special label.
 */
export function renderBoard(board: BoardState, title?: string): string {
  const cellW = 5;
  const top = "┌" + Array(3).fill("─".repeat(cellW)).join("┬") + "┐";
  const mid = "├" + Array(3).fill("─".repeat(cellW)).join("┼") + "┤";
  const bot = "└" + Array(3).fill("─".repeat(cellW)).join("┴") + "┘";

  const lines: string[] = [];
  if (title) lines.push(title);
  lines.push(top);
  for (let r = 0; r < 3; r++) {
    const cells: string[] = [];
    for (let c = 0; c < 3; c++) {
      const fid = ALL_FIELDS[r * 3 + c];
      const t = board[fid];
      const glyph = tileGlyph(t);
      const tag =
        t.special === "source" ? "S" :
        t.special === "plant" ? "P" :
        t.special === "empty" ? " " :
        " ";
      cells.push(` ${glyph} ${tag} `);
    }
    lines.push("│" + cells.join("│") + "│");
    if (r < 2) lines.push(mid);
  }
  lines.push(bot);

  // Add legend line per row with field ids and edge text
  lines.push("");
  for (let r = 0; r < 3; r++) {
    const parts: string[] = [];
    for (let c = 0; c < 3; c++) {
      const fid = ALL_FIELDS[r * 3 + c];
      const t = board[fid];
      const labelStr = t.label ? ` "${t.label}"` : "";
      parts.push(`${fid}: ${tileEdgesToText(t)}[${t.special}${labelStr}]`);
    }
    lines.push(parts.join("   "));
  }
  return lines.join("\n");
}

export type DiffEntry = {
  field: FieldId;
  current: Tile;
  target: Tile;
  rotations: number | null;
  matches: boolean;
};

export function computeDiff(current: BoardState, target: BoardState): DiffEntry[] {
  const entries: DiffEntry[] = [];
  for (const fid of ALL_FIELDS) {
    const cur = current[fid];
    const tgt = target[fid];
    const rot = rotationsNeeded(cur, tgt);
    entries.push({
      field: fid,
      current: cur,
      target: tgt,
      rotations: rot,
      matches: edgesEqual(cur, tgt),
    });
  }
  return entries;
}

export function renderDiff(diff: DiffEntry[]): string {
  const lines: string[] = [];
  lines.push("Pole | bieżący → docelowy | obrotów");
  lines.push("-----|--------------------|--------");
  let total = 0;
  for (const d of diff) {
    const cur = `${tileGlyph(d.current)} (${tileEdgesToText(d.current)})`;
    const tgt = `${tileGlyph(d.target)} (${tileEdgesToText(d.target)})`;
    const rot =
      d.rotations === null ? "NIEMOŻLIWE (różny zestaw krawędzi)" :
      d.rotations === 0 ? "✓ OK" :
      `${d.rotations}× w prawo`;
    lines.push(`${d.field}  | ${cur.padEnd(10)} → ${tgt.padEnd(10)} | ${rot}`);
    if (d.rotations && d.rotations > 0) total += d.rotations;
  }
  lines.push("");
  lines.push(`SUMA OBROTÓW: ${total}`);
  return lines.join("\n");
}

/**
 * Compact one-line summary like:
 *   "1x1=└ 1x2=─ 1x3=┐ | 2x1=│ 2x2=┼ 2x3=│ | 3x1=└ 3x2=─ 3x3=┘"
 * Useful for terse logging inside the agent loop.
 */
export function compactBoard(board: BoardState): string {
  const rows: string[] = [];
  for (let r = 0; r < 3; r++) {
    const cells: string[] = [];
    for (let c = 0; c < 3; c++) {
      const fid = ALL_FIELDS[r * 3 + c];
      cells.push(`${fid}=${tileGlyph(board[fid])}`);
    }
    rows.push(cells.join(" "));
  }
  return rows.join(" | ");
}
