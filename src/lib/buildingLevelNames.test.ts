import { describe, expect, test } from "bun:test";
import { qualifyLevelName, stripBuildingPrefix } from "./buildingLevelNames";

describe("building level names", () => {
  test("qualifies short name with building", () => {
    expect(qualifyLevelName("Level 0", "Block B")).toBe("Block B Level 0");
  });
  test("does not double-prefix", () => {
    expect(qualifyLevelName("Block B Level 0", "Block B")).toBe("Block B Level 0");
  });
  test("no building keeps name", () => {
    expect(qualifyLevelName("Level 0", null)).toBe("Level 0");
  });
  test("strips building prefix for display", () => {
    expect(stripBuildingPrefix("Block A2 Level 3", "Block A2")).toBe("Level 3");
  });
  test("does not strip other building", () => {
    expect(stripBuildingPrefix("Block A2 Level 3", "Block B")).toBe("Block A2 Level 3");
  });
});
