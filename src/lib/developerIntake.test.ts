import { describe, expect, test } from "bun:test";
import { clampCoverage, snapCoverage, snapTolerance, developerProjectDetails, restoreDeveloperChoices, developerScopeDetails, isOwnershipIntent } from "./developerIntake";

describe("developer intake rules", () => {
  test("extraction scope defaults to Match Engineer's Design", () => {
    expect(restoreDeveloperChoices({}).extractionScope).toBe(0);
    expect(developerScopeDetails(0, "construction_only").risk_extraction_scope).toBe("engineer_design");
  });
  test("ownership starts unselected and does not map legacy phases", () => {
    expect(restoreDeveloperChoices({}).ownershipIntent).toBe("");
    expect(restoreDeveloperChoices({ protection_phase: ["Construction", "Operational"] }).ownershipIntent).toBe("");
    expect(isOwnershipIntent("")).toBe(false);
  });
  test("each extraction scope saves and restores independently of target protection", () => {
    for (const [index, key] of ["engineer_design", "design_upgrades", "comprehensive"].entries()) {
      const details = developerScopeDetails(index, "long_term_hold");
      expect(details.risk_extraction_scope).toBe(key);
      expect(restoreDeveloperChoices(details).extractionScope).toBe(index);
    }
  });
  test("all three ownership intents save and restore as single choices", () => {
    for (const intent of ["construction_only", "smart_amenity", "long_term_hold"] as const) {
      expect(isOwnershipIntent(intent)).toBe(true);
      expect(restoreDeveloperChoices(developerScopeDetails(1, intent)).ownershipIntent).toBe(intent);
    }
    expect(isOwnershipIntent("Operational")).toBe(false);
  });
  test("new intake omits removed minimum protection scope", () => {
    expect(developerProjectDetails("250,000", 1)).toEqual({ intake_type: "developer", water_mitigation_budget: 250_000, riskTolerance: "medium" });
  });
  test("coverage ranges from zero to ten million", () => {
    expect(clampCoverage(-100)).toBe(0);
    expect(clampCoverage(10_000_001)).toBe(10_000_000);
  });
  test("coverage slider snaps to one hundred thousand", () => {
    expect(snapCoverage(1_249_999)).toBe(1_200_000);
    expect(snapCoverage(1_250_001)).toBe(1_300_000);
  });
  test("direct entry preserves amounts between ticks", () => {
    expect(clampCoverage(123_456)).toBe(123_456);
  });
  test("protection slider snaps to three ticks", () => {
    expect([0.2, 0.8, 1.8].map(snapTolerance)).toEqual([0, 1, 2]);
  });
  test("essential stores high tolerance and comprehensive stores low", () => {
    expect(developerProjectDetails("0", 0).riskTolerance).toBe("high");
    expect(developerProjectDetails("0", 2).riskTolerance).toBe("low");
  });
  test("all four protection limits and budget persist", () => {
    expect(developerProjectDetails("250,000", 1, { general_liability: 100_000, workers_compensation: 200_000, pollution_environmental_liability: 300_000, excess_umbrella_liability: 10_000_000 })).toEqual({
      intake_type: "developer", water_mitigation_budget: 250_000, riskTolerance: "medium",
      minimum_protection_scope: { general_liability: 100_000, workers_compensation: 200_000, pollution_environmental_liability: 300_000, excess_umbrella_liability: 10_000_000 },
    });
  });
});