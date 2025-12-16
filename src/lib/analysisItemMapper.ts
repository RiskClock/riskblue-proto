// Types for AI analysis items
export interface AnalysisItem {
  id: string;
  name: string;
  category: "Asset" | "Water System" | "Process";
  areaName: string | null;
  floor: string | null;
  drawingCode: string | null;
  fileName: string | null;
  width: number | null;
  length: number | null;
  areaSqft: number | null;
  // Also support snake_case from edge function
  area_sqft?: number | null;
  sizeCategory: "very small" | "small" | "medium" | "large" | "very large" | null;
  controls: string[];
  coordinates: [number, number, number, number] | null;
  // Additional parameters for water systems (pipe diameter, etc.)
  additionalParameters?: {
    mainPipeDirection?: string;
    pipeDiameterInches?: number | null;
    pipeDiameterMM?: number | null;
  };
}

// Map TMU analysis names to database asset names
const ASSET_NAME_MAP: Record<string, string> = {
  // Exact matches
  "Electrical Room": "Electrical Room",
  "Electrical Rooms": "Electrical Room",
  "Elevator Pit": "Elevator Pit",
  "Elevator Pits": "Elevator Pit",
  "Suite": "Suite",
  "Suites": "Suite",
  "Guest Rooms": "Suite",
  "Suites/Guest Rooms": "Suite",
  "Mechanical Room": "Mechanical Room",
  "Mechanical Rooms": "Mechanical Room",
  "Electrical Riser": "Electrical Riser",
  "Electrical Risers": "Electrical Riser",
  "Main Electrical Risers": "Electrical Riser",
  "Mechanical Riser": "Mechanical Riser",
  "Mechanical Risers": "Mechanical Riser",
  "Mass Timber and Millwork": "Mass Timber and Millwork",
  "Facade and Envelope": "Facade, Envelope, Exterior, and Roofing",
  "Facade, Envelope, Exterior, and Roofing": "Facade, Envelope, Exterior, and Roofing",
  "Kitchens & Washroom": "Kitchens & Washroom",
  "Kitchens & Washrooms": "Kitchens & Washroom",
};

// Map TMU analysis names to database water system names
const WATER_SYSTEM_NAME_MAP: Record<string, string> = {
  // Temporary Water Run
  "Temporary Water Run": "Temporary Water Run",
  
  // Hydronics
  "Hydronics": "Hydronics",
  
  // Fire Suppression System
  "Fire Suppression System": "Fire Suppression System",
  "Fire Protection": "Fire Suppression System",
  "FSP": "Fire Suppression System",
  
  // Sump Pits, Storm Drains and Drainages
  "Sump Pits, Storm Drains and Drainages": "Sump Pits, Storm Drains and Drainages",
  "Sump Pit, Storm Drain, and Drainage": "Sump Pits, Storm Drains and Drainages",
  "Sump Pit": "Sump Pits, Storm Drains and Drainages",
  "Storm Drain": "Sump Pits, Storm Drains and Drainages",
  "Stormwater": "Sump Pits, Storm Drains and Drainages",
  
  // Domestic Hot Water
  "Domestic Hot Water": "Domestic Hot Water",
  "Hot Domestic Water": "Domestic Hot Water",
  "Hot Water Return": "Domestic Hot Water",
  
  // Domestic Cold Water (consolidated)
  "Domestic Cold Water": "Domestic Cold Water",
  "Cold Domestic Water": "Domestic Cold Water",
  "Domestic Cold Water: Main City Entry": "Domestic Cold Water",
  "Domestic Cold Water: Main Entry": "Domestic Cold Water",
  "Domestic Cold Water: Zone Entry": "Domestic Cold Water",
  "Domestic Cold Water: Suite Riser Entry": "Domestic Cold Water",
  "Domestic Cold Water: Suite Entry": "Domestic Cold Water",
  "Cold Domestic Water: Main City Entry": "Domestic Cold Water",
  "Cold Domestic Water: Main Entry": "Domestic Cold Water",
  "Cold Domestic Water: Zone Entry": "Domestic Cold Water",
  "Cold Domestic Water: Suite Riser Entry": "Domestic Cold Water",
  "Cold Domestic Water: Suite Entry": "Domestic Cold Water",
  "Main City Water Supply": "Domestic Cold Water",
  "Main Water Entry": "Domestic Cold Water",
};

// Map TMU analysis names to database process names
const PROCESS_NAME_MAP: Record<string, string> = {
  "Contractor Team": "Contractor Team",
  "Water Mitigation Vendor Process": "Water Mitigation Vendor Process",
  "Water Mitigation Vendor": "Water Mitigation Vendor Process",
  "Mechanical Contractor Process": "Mechanical Contractor Process",
  "Mechanical Contractor": "Mechanical Contractor Process",
  "Engineering Process": "Engineering Process",
  "Engineering": "Engineering Process",
};

/**
 * Maps an analysis item's name to the corresponding database asset name
 */
export function mapToAssetName(analysisName: string): string | null {
  // Try exact match first
  if (ASSET_NAME_MAP[analysisName]) {
    return ASSET_NAME_MAP[analysisName];
  }
  
  // Try partial matching for common patterns
  const lowerName = analysisName.toLowerCase();
  
  if (lowerName.includes("electrical room")) return "Electrical Room";
  if (lowerName.includes("mechanical room")) return "Mechanical Room";
  if (lowerName.includes("electrical riser")) return "Electrical Riser";
  if (lowerName.includes("mechanical riser")) return "Mechanical Riser";
  if (lowerName.includes("elevator pit")) return "Elevator Pit";
  if (lowerName.includes("suite") || lowerName.includes("guest room")) return "Suite";
  if (lowerName.includes("kitchen") || lowerName.includes("washroom") || lowerName.includes("w/c")) return "Kitchens & Washroom";
  if (lowerName.includes("facade") || lowerName.includes("envelope") || lowerName.includes("exterior") || lowerName.includes("roofing")) return "Facade, Envelope, Exterior, and Roofing";
  if (lowerName.includes("mass timber") || lowerName.includes("millwork")) return "Mass Timber and Millwork";
  
  return null;
}

/**
 * Maps an analysis item's name to the corresponding database water system name
 */
export function mapToWaterSystemName(analysisName: string): string | null {
  // Try exact match first
  if (WATER_SYSTEM_NAME_MAP[analysisName]) {
    return WATER_SYSTEM_NAME_MAP[analysisName];
  }
  
  // Try partial matching for common patterns
  const lowerName = analysisName.toLowerCase();
  
  // Cold water (all variants consolidated to single entry)
  if (lowerName.includes("cold") && (lowerName.includes("domestic") || lowerName.includes("water"))) {
    return "Domestic Cold Water";
  }
  
  // Hot water
  if (lowerName.includes("hot") && (lowerName.includes("domestic") || lowerName.includes("water"))) {
    return "Domestic Hot Water";
  }
  
  // Other systems
  if (lowerName.includes("temporary") && lowerName.includes("water")) return "Temporary Water Run";
  if (lowerName.includes("hydronic")) return "Hydronics";
  if (lowerName.includes("fire") && (lowerName.includes("suppression") || lowerName.includes("protection") || lowerName.includes("sprinkler"))) {
    return "Fire Suppression System";
  }
  if (lowerName.includes("sump") || lowerName.includes("storm drain") || lowerName.includes("drainage")) {
    return "Sump Pits, Storm Drains and Drainages";
  }
  
  return null;
}

/**
 * Maps an analysis item's name to the corresponding database process name
 */
export function mapToProcessName(analysisName: string): string | null {
  // Try exact match first
  if (PROCESS_NAME_MAP[analysisName]) {
    return PROCESS_NAME_MAP[analysisName];
  }
  
  // Try partial matching for common patterns
  const lowerName = analysisName.toLowerCase();
  
  if (lowerName.includes("contractor team")) return "Contractor Team";
  if (lowerName.includes("water mitigation") && lowerName.includes("vendor")) return "Water Mitigation Vendor Process";
  if (lowerName.includes("mechanical contractor")) return "Mechanical Contractor Process";
  if (lowerName.includes("engineering")) return "Engineering Process";
  
  return null;
}

/**
 * Extracts unique asset names from analysis items
 */
export function extractSelectedAssets(items: AnalysisItem[]): string[] {
  const assetItems = items.filter(item => item.category === "Asset");
  const mappedNames = assetItems
    .map(item => mapToAssetName(item.name))
    .filter((name): name is string => name !== null);
  
  return [...new Set(mappedNames)];
}

/**
 * Extracts unique water system names from analysis items
 */
export function extractSelectedSystems(items: AnalysisItem[]): string[] {
  const systemItems = items.filter(item => item.category === "Water System");
  const mappedNames = systemItems
    .map(item => mapToWaterSystemName(item.name))
    .filter((name): name is string => name !== null);
  
  return [...new Set(mappedNames)];
}

/**
 * Extracts unique process names from analysis items
 */
export function extractSelectedProcesses(items: AnalysisItem[]): string[] {
  const processItems = items.filter(item => item.category === "Process");
  const mappedNames = processItems
    .map(item => mapToProcessName(item.name))
    .filter((name): name is string => name !== null);
  
  return [...new Set(mappedNames)];
}

/**
 * Groups analysis items by category
 */
export function groupByCategory(items: AnalysisItem[]): {
  assets: AnalysisItem[];
  waterSystems: AnalysisItem[];
  processes: AnalysisItem[];
} {
  return {
    assets: items.filter(item => item.category === "Asset"),
    waterSystems: items.filter(item => item.category === "Water System"),
    processes: items.filter(item => item.category === "Process"),
  };
}

/**
 * Counts items by category
 */
export function countByCategory(items: AnalysisItem[]): {
  assets: number;
  waterSystems: number;
  processes: number;
  total: number;
} {
  const grouped = groupByCategory(items);
  return {
    assets: grouped.assets.length,
    waterSystems: grouped.waterSystems.length,
    processes: grouped.processes.length,
    total: items.length,
  };
}
