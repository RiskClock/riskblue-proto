import { describe, it, expect } from "vitest";
import { groupSpacesByBuilding } from "./threatReportBuildings";

const parsed = {
  buildings: [{ id: "a", name: "Tower A" }, { id: "b", name: "Tower B" }],
  spatial_records: [
    { standardized_space_name: "A L1", building_ids: ["a"] },
    { standardized_space_name: "B L1", building_ids: ["b"] },
    { standardized_space_name: "Podium", building_ids: ["a", "b"] },
  ],
};

describe("groupSpacesByBuilding", () => {
  it("puts levels linked to several buildings in Shared Spaces", () => {
    const g = groupSpacesByBuilding(["A L1", "Podium", "B L1", "__unassigned__"], parsed)!;
    expect(g.map((x) => x.label)).toEqual(["Tower A", "Tower B", "Shared Spaces", "Unassigned"]);
    expect(g[2].spaces).toEqual(["Podium"]);
    expect(g[3].spaces).toEqual(["__unassigned__"]);
  });
  it("keeps the flat list for single-building projects", () => {
    expect(groupSpacesByBuilding(["L1"], { buildings: [{ id: "a", name: "A" }] })).toBeNull();
  });
});
