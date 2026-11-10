import { describe, expect, it } from "vitest";
import { addRange, cellId, rectCells, toggleCell } from "./instanceGridSelection";

const rows = ["L0", "L1", "L2"];
const cols = ["ASV", "WM"];

describe("instance grid selection", () => {
  it("drag selects the full rectangle regardless of direction", () => {
    expect(rectCells({ row: 2, col: 1 }, { row: 1, col: 0 }, rows, cols).sort()).toEqual(
      [cellId("L1", "ASV"), cellId("L1", "WM"), cellId("L2", "ASV"), cellId("L2", "WM")].sort(),
    );
  });
  it("ctrl+click toggles one cell off and on", () => {
    const s = new Set([cellId("L0", "ASV"), cellId("L1", "ASV")]);
    const off = toggleCell(s, cellId("L0", "ASV"));
    expect(off.has(cellId("L0", "ASV"))).toBe(false);
    expect(off.size).toBe(1);
    expect(toggleCell(off, cellId("L0", "ASV")).size).toBe(2);
  });
  it("ctrl+drag keeps the earlier selection", () => {
    const s = addRange(new Set([cellId("L0", "WM")]), [cellId("L2", "ASV")]);
    expect(s.size).toBe(2);
  });
});
