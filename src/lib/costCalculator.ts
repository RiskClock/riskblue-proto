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
