/**
 * Pricing tier from control_pricing_tiers table
 */
export interface PricingTier {
  id: string;
  control_name: string;
  tier_type: 'room_size' | 'diameter';
  tier_label: string;
  min_value: number;
  max_value: number;
  one_time_cost: number;
  monthly_cost: number;
  unit: string;
}

/**
 * Instance data needed for tiered pricing lookup
 */
export interface InstancePricingData {
  width?: number | null;
  length?: number | null;
  sizeCategory?: string | null;
  pipeDiameterInches?: number | null;
}

/**
 * Calculate total control cost based on upfront cost + (monthly cost × duration)
 * If duration is unknown, returns just the upfront cost
 */
export const calculateControlCost = (
  oneTimeCost: number,
  monthlyMaintCost: number,
  durationMonths: number | null
): number => {
  if (durationMonths && durationMonths > 0) {
    return oneTimeCost + (monthlyMaintCost * durationMonths);
  }
  return oneTimeCost;
};

/**
 * Parse duration string like "12 months" or "N/A" to get number of months
 * Returns null if duration cannot be parsed
 */
export const parseDurationMonths = (duration: string | null | undefined): number | null => {
  if (!duration || duration === "N/A" || duration === "Error") {
    return null;
  }
  
  // Try to extract number from strings like "12 months", "6 months", etc.
  const match = duration.match(/(\d+)\s*months?/i);
  if (match) {
    return parseInt(match[1], 10);
  }
  
  // Try to parse as a plain number
  const parsed = parseInt(duration, 10);
  if (!isNaN(parsed)) {
    return parsed;
  }
  
  return null;
};

/**
 * Default room sizes (in sq ft) for each size category
 */
const SIZE_CATEGORY_DEFAULTS: Record<string, number> = {
  small: 150,
  medium: 350,
  large: 750,
  'extra large': 1500,
};

/**
 * Look up the appropriate pricing tier for a control based on instance data
 */
export const lookupPricingTier = (
  controlName: string,
  instanceData: InstancePricingData,
  pricingTiers: PricingTier[]
): PricingTier | null => {
  // Get all tiers for this control
  const controlTiers = pricingTiers.filter(t => t.control_name === controlName);
  if (controlTiers.length === 0) return null;

  const tierType = controlTiers[0].tier_type;

  if (tierType === 'room_size') {
    // Calculate area from width × length, or use size category default
    let area: number | null = null;
    
    if (instanceData.width && instanceData.length) {
      area = instanceData.width * instanceData.length;
    } else if (instanceData.sizeCategory) {
      const category = instanceData.sizeCategory.toLowerCase();
      area = SIZE_CATEGORY_DEFAULTS[category] || SIZE_CATEGORY_DEFAULTS.medium;
    }
    
    if (area === null) {
      // Default to medium if no size info
      area = SIZE_CATEGORY_DEFAULTS.medium;
    }

    // Find matching tier
    return controlTiers.find(t => area! >= t.min_value && area! <= t.max_value) || null;
  }

  if (tierType === 'diameter') {
    const diameter = instanceData.pipeDiameterInches;
    if (diameter === null || diameter === undefined) {
      // Default to 2" diameter if not specified
      return controlTiers.find(t => 2 >= t.min_value && 2 <= t.max_value) || controlTiers[0];
    }
    return controlTiers.find(t => diameter >= t.min_value && diameter <= t.max_value) || null;
  }

  return null;
};

/**
 * Calculate tiered control cost for a specific instance
 * Falls back to direct costs if no tier is found
 */
export const calculateTieredControlCost = (
  controlName: string,
  instanceData: InstancePricingData,
  pricingTiers: PricingTier[],
  fallbackOneTimeCost: number,
  fallbackMonthlyCost: number,
  durationMonths: number | null
): number => {
  const tier = lookupPricingTier(controlName, instanceData, pricingTiers);
  
  if (tier) {
    return calculateControlCost(tier.one_time_cost, tier.monthly_cost, durationMonths);
  }
  
  // Fallback to direct costs from mitigation_controls
  return calculateControlCost(fallbackOneTimeCost, fallbackMonthlyCost, durationMonths);
};
