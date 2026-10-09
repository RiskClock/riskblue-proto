export const COVERAGE_MAX = 10_000_000;
export const COVERAGE_STEP = 100_000;
export const COVERAGE_FIELDS = [
  { key: "general_liability", label: "General Liability" },
  { key: "workers_compensation", label: "Worker's Compensation" },
  { key: "pollution_environmental_liability", label: "Pollution/Environmental Liability" },
  { key: "excess_umbrella_liability", label: "Excess/Umbrella Liability" },
] as const;
export type CoverageKey = typeof COVERAGE_FIELDS[number]["key"];
export const clampCoverage = (value: number) => Math.min(COVERAGE_MAX, Math.max(0, Number.isFinite(value) ? value : 0));
export const snapCoverage = (value: number) => clampCoverage(Math.round(value / COVERAGE_STEP) * COVERAGE_STEP);
export const snapTolerance = (value: number) => Math.min(2, Math.max(0, Math.round(value)));
export const developerProjectDetails = (budget: string, tolerance: number, scope: Record<CoverageKey, number>) => ({
  intake_type: "developer",
  water_mitigation_budget: Number(budget.replace(/[^\d]/g, "")) || 0,
  riskTolerance: ["low", "medium", "high"][snapTolerance(tolerance)],
  minimum_protection_scope: Object.fromEntries(COVERAGE_FIELDS.map(({ key }) => [key, clampCoverage(scope[key])])),
});