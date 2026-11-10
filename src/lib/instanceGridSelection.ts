/**
 * Spreadsheet-style cell selection for the Workbench Instances view.
 * Cells are addressed by (row index, column index) over the currently
 * visible selectable rows, and stored as "rowKey|colKey" ids.
 */
export const cellId = (rowKey: string, colKey: string) => `${rowKey}|${colKey}`;

export interface GridPoint { row: number; col: number }

/** Every cell id in the rectangle spanned by two points (inclusive). */
export function rectCells(a: GridPoint, b: GridPoint, rowKeys: string[], colKeys: string[]): string[] {
  const r1 = Math.max(0, Math.min(a.row, b.row));
  const r2 = Math.min(rowKeys.length - 1, Math.max(a.row, b.row));
  const c1 = Math.max(0, Math.min(a.col, b.col));
  const c2 = Math.min(colKeys.length - 1, Math.max(a.col, b.col));
  const out: string[] = [];
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) out.push(cellId(rowKeys[r], colKeys[c]));
  return out;
}

/** Ctrl/Cmd+click: add the cell when unselected, remove it when selected. */
export function toggleCell(selection: Set<string>, id: string): Set<string> {
  const next = new Set(selection);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Union of a base selection with a dragged rectangle (Ctrl/Cmd+drag adds a range). */
export function addRange(base: Set<string>, cells: string[]): Set<string> {
  const next = new Set(base);
  cells.forEach((c) => next.add(c));
  return next;
}
