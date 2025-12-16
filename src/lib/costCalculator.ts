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
  areaSqft?: number | null;
  sizeCategory?: string | null;
  pipeDiameterInches?: number | null;
  additionalParameters?: {
    pipeDiameterInches?: number | null;
    pipeDiameterMM?: number | null;
    mainPipeDirection?: string;
  };
}

/**
 * Controls that scale by sensor count based on room size
 */
export const SENSOR_SCALED_CONTROLS = ['Presence of Water Monitoring'];

/**
 * Instance types that always use single sensor regardless of room size
 */
export const SINGLE_SENSOR_INSTANCE_TYPES = ['Sump Pit', 'Storm Drain', 'Drainage'];

/**
 * Calculate total control cost based on upfront cost + (monthly cost × duration × sensor count)
 * If duration is unknown, returns just the upfront cost
 * @param sensorCount Number of sensors required (multiplies monthly cost)
 */
export const calculateControlCost = (
  oneTimeCost: number,
  monthlyMaintCost: number,
  durationMonths: number | null,
  sensorCount: number = 1
): number => {
  if (durationMonths && durationMonths > 0) {
    return oneTimeCost + (monthlyMaintCost * durationMonths * sensorCount);
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
 * Size category thresholds (max sq ft for each category)
 */
export const SIZE_THRESHOLDS = {
  VERY_SMALL_MAX: 149,
  SMALL_MAX: 300,
  MEDIUM_MAX: 600,
  LARGE_MAX: 1200,
};

/**
 * Sensor count required per room size category
 */
export const SENSOR_COUNT_BY_SIZE: Record<string, number> = {
  'very small': 1,
  'small': 1,
  'medium': 2,
  'large': 3,
  'very large': 5,
};

/**
 * Default room sizes (in sq ft) for each size category
 */
const SIZE_CATEGORY_DEFAULTS: Record<string, number> = {
  'very small': 75,
  small: 225,
  medium: 450,
  large: 900,
  'very large': 1500,
};

/**
 * Derive size category from area in square feet
 */
export function getSizeCategory(areaSqft: number | null): 'very small' | 'small' | 'medium' | 'large' | 'very large' | null {
  if (!areaSqft || areaSqft <= 0) return null;
  if (areaSqft <= SIZE_THRESHOLDS.VERY_SMALL_MAX) return 'very small';
  if (areaSqft <= SIZE_THRESHOLDS.SMALL_MAX) return 'small';
  if (areaSqft <= SIZE_THRESHOLDS.MEDIUM_MAX) return 'medium';
  if (areaSqft <= SIZE_THRESHOLDS.LARGE_MAX) return 'large';
  return 'very large';
}

/**
 * Get the number of sensors required for a room size category
 */
export function getSensorCount(sizeCategory: string | null): number {
  if (!sizeCategory) return 1;
  return SENSOR_COUNT_BY_SIZE[sizeCategory.toLowerCase()] || 1;
}

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
 * Only applies sensor count multiplier for SENSOR_SCALED_CONTROLS (e.g., "Presence of Water Monitoring")
 * and excludes SINGLE_SENSOR_INSTANCE_TYPES (e.g., Sump Pits) which always use 1 sensor
 * @param instanceName Optional instance name to check for single-sensor instance types
 */
export const calculateTieredControlCost = (
  controlName: string,
  instanceData: InstancePricingData,
  pricingTiers: PricingTier[],
  fallbackOneTimeCost: number,
  fallbackMonthlyCost: number,
  durationMonths: number | null,
  instanceName?: string
): number => {
  // Default sensor count to 1
  let sensorCount = 1;
  
  // Only scale by sensors for specific controls (e.g., "Presence of Water Monitoring")
  if (SENSOR_SCALED_CONTROLS.includes(controlName)) {
    // Check if this is a single-sensor instance type (Sump Pit, Storm Drain, Drainage)
    const isSingleSensorInstance = instanceName && 
      SINGLE_SENSOR_INSTANCE_TYPES.some(type => 
        instanceName.toLowerCase().includes(type.toLowerCase())
      );
    
    if (!isSingleSensorInstance) {
      // Calculate sensor count from room size
      let sizeCategory = instanceData.sizeCategory;
      if (!sizeCategory && instanceData.areaSqft) {
        sizeCategory = getSizeCategory(instanceData.areaSqft);
      } else if (!sizeCategory && instanceData.width && instanceData.length) {
        sizeCategory = getSizeCategory(instanceData.width * instanceData.length);
      }
      sensorCount = getSensorCount(sizeCategory || null);
    }
  }
  
  // Get pipe diameter from additionalParameters if available
  const pipeDiameter = instanceData.pipeDiameterInches ?? 
    instanceData.additionalParameters?.pipeDiameterInches ?? null;
  
  // Create lookup data with resolved pipe diameter
  const lookupData: InstancePricingData = {
    ...instanceData,
    pipeDiameterInches: pipeDiameter,
  };
  
  const tier = lookupPricingTier(controlName, lookupData, pricingTiers);
  
  if (tier) {
    return calculateControlCost(tier.one_time_cost, tier.monthly_cost, durationMonths, sensorCount);
  }
  
  // Fallback to direct costs from mitigation_controls
  return calculateControlCost(fallbackOneTimeCost, fallbackMonthlyCost, durationMonths, sensorCount);
};
