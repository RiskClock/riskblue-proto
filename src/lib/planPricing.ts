/**
 * Per-plan pricing overrides for Water Mitigation Plans.
 *
 * Catalog pricing stays the default; a plan may override any of the three
 * amounts (one-time, installation, recurring) plus the recurring interval.
 * Overrides live in `project_mitigation_plans.product_assignments.__pricing`.
 */
export type RecurringInterval = "monthly" | "yearly";

export interface ProductPricing {
  oneTime: number;
  install: number;
  recurring: number;
  interval: RecurringInterval;
}

export interface PricingOverride {
  oneTime?: number | null;
  install?: number | null;
  recurring?: number | null;
  interval?: RecurringInterval | null;
}

export type PricingOverrides = Record<string, PricingOverride>;

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

/** True when the plan has any custom amount or interval for the product. */
export const hasCustomPricing = (override?: PricingOverride | null): boolean =>
  !!override &&
  (num(override.oneTime) !== null ||
    num(override.install) !== null ||
    num(override.recurring) !== null ||
    override.interval === "monthly" ||
    override.interval === "yearly");

export const mergePricing = (base: ProductPricing, override?: PricingOverride | null): ProductPricing => ({
  oneTime: num(override?.oneTime) ?? base.oneTime,
  install: num(override?.install) ?? base.install,
  recurring: num(override?.recurring) ?? base.recurring,
  interval: override?.interval ?? base.interval,
});

/** Annualised unit cost, matching the Product Catalog calculation. */
export const annualUnitCost = (pricing: ProductPricing): number =>
  pricing.oneTime + pricing.install + (pricing.interval === "yearly" ? pricing.recurring : pricing.recurring * 12);

/** How the cost should be labelled: recurring-only products show a period. */
export const costPeriodOf = (pricing: ProductPricing): "unit" | "month" | "year" =>
  pricing.oneTime === 0 && pricing.install === 0 && pricing.recurring > 0
    ? pricing.interval === "yearly"
      ? "year"
      : "month"
    : "unit";

/** Drops empty entries so saved plans only carry real overrides. */
export const cleanPricingOverrides = (value: PricingOverrides = {}): PricingOverrides =>
  Object.fromEntries(
    Object.entries(value)
      .map(([id, override]) => {
        const next: PricingOverride = {};
        if (num(override?.oneTime) !== null) next.oneTime = num(override.oneTime)!;
        if (num(override?.install) !== null) next.install = num(override.install)!;
        if (num(override?.recurring) !== null) next.recurring = num(override.recurring)!;
        if (override?.interval === "monthly" || override?.interval === "yearly") next.interval = override.interval;
        return [id, next] as const;
      })
      .filter(([, override]) => hasCustomPricing(override))
      .sort(([a], [b]) => a.localeCompare(b)),
  );

/** Reads the `__pricing` bucket out of a plan's product assignments. */
export const readPlanPricing = (assignments: Record<string, unknown> | null | undefined): PricingOverrides => {
  const raw = (assignments || {})["__pricing"];
  if (!raw || Array.isArray(raw) || typeof raw !== "object") return {};
  return cleanPricingOverrides(raw as PricingOverrides);
};
