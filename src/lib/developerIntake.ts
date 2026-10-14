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
export const EXTRACTION_SCOPES = [
  { key: "engineer_design", label: "Match Engineer's Design", short: "Engineer's Design", body: "RiskBlue will only extract risk areas explicitly addressed in the mechanical drawings." },
  { key: "design_upgrades", label: "Design + Recommended Upgrades", short: "Design + Upgrades", body: "RiskBlue will extract the designed systems and identify additional risk areas to meet your target protection level." },
  { key: "comprehensive", label: "Comprehensive Assessment", short: "Comprehensive", body: "RiskBlue will evaluate the entire project and recommend a complete list of risk areas from scratch." },
] as const;
export const OWNERSHIP_INTENTS = [
  { key: "construction_only", label: "Build & Sell (Construction Only)", short: "Construction Only", body: "Protection is strictly required for the Course of Construction phase prior to handover." },
  { key: "smart_amenity", label: "Build & Sell (Smart Amenity)", short: "Smart Amenity", body: "Sensors remain installed as a premium, marketable tech amenity for future buyers or tenants." },
  { key: "long_term_hold", label: "Long-Term Hold", short: "Long-Term Hold", body: "Permanent installation designed to lower operating costs, optimize insurance premiums, and protect the asset." },
] as const;
export const extractionScopeLabel = (key: unknown) => EXTRACTION_SCOPES.find((scope) => scope.key === key)?.short ?? "-";
export const ownershipIntentLabel = (key: unknown) => OWNERSHIP_INTENTS.find((intent) => intent.key === key)?.short ?? "-";
export type OwnershipIntent = typeof OWNERSHIP_INTENTS[number]["key"];
export const isOwnershipIntent = (value: unknown): value is OwnershipIntent => OWNERSHIP_INTENTS.some((intent) => intent.key === value);
export const restoreDeveloperChoices = (details: Record<string, unknown>) => ({
  extractionScope: Math.max(0, EXTRACTION_SCOPES.findIndex((scope) => scope.key === details.risk_extraction_scope)),
  ownershipIntent: isOwnershipIntent(details.system_ownership_intent) ? details.system_ownership_intent : "",
});
export const developerScopeDetails = (scope: number, intent: OwnershipIntent) => ({
  risk_extraction_scope: EXTRACTION_SCOPES[snapTolerance(scope)].key,
  system_ownership_intent: intent,
});
export const developerProjectDetails = (budget: string, tolerance: number, scope?: Record<CoverageKey, number>) => ({
  intake_type: "developer",
  water_mitigation_budget: Number(budget.replace(/[^\d]/g, "")) || 0,
  // Slider reads Essential -> Balanced -> Comprehensive; stored riskTolerance inverts it
  // (comprehensive protection = low risk tolerance, as consumed by the project wizard).
  riskTolerance: ["high", "medium", "low"][snapTolerance(tolerance)],
  ...(scope ? { minimum_protection_scope: Object.fromEntries(COVERAGE_FIELDS.map(({ key }) => [key, clampCoverage(scope[key])])) } : {}),
});