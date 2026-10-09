/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { clampCoverage, snapCoverage, snapTolerance, developerProjectDetails } from "./developerIntake";

describe("developer intake rules", () => {
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
  test("risk slider snaps to low medium and high", () => {
    expect([0.2, 0.8, 1.8].map(snapTolerance)).toEqual([0, 1, 2]);
  });
  test("all four protection limits and budget persist", () => {
    expect(developerProjectDetails("250,000", 1, { general_liability: 100_000, workers_compensation: 200_000, pollution_environmental_liability: 300_000, excess_umbrella_liability: 10_000_000 })).toEqual({
      intake_type: "developer", water_mitigation_budget: 250_000, riskTolerance: "medium",
      minimum_protection_scope: { general_liability: 100_000, workers_compensation: 200_000, pollution_environmental_liability: 300_000, excess_umbrella_liability: 10_000_000 },
    });
  });
});