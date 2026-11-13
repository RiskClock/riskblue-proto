import { describe, expect, test as it } from "bun:test";
import { moveEntryKey, orderInstanceEntries } from "./instanceColumnOrder";

const e = (key: string, canonicalName = key) => ({ key, canonicalName });

describe("instance column order", () => {
  it("defaults to the Count tab class order", () => {
    const out = orderInstanceEntries([e("A"), e("B::x::1", "B"), e("C")], ["C", "B", "A"], []);
    expect(out.map((x) => x.key)).toEqual(["C", "B::x::1", "A"]);
  });
  it("saved project order wins over class order", () => {
    const out = orderInstanceEntries([e("A"), e("B"), e("C")], ["A", "B", "C"], ["C", "A"]);
    expect(out.map((x) => x.key)).toEqual(["C", "A", "B"]);
  });
  it("drag moves a column to the drop target position", () => {
    expect(moveEntryKey(["A", "B", "C"], "A", "C")).toEqual(["B", "C", "A"]);
    expect(moveEntryKey(["A", "B", "C"], "C", "A")).toEqual(["C", "A", "B"]);
  });
});
