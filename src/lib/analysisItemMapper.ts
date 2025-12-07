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
  sizeCategory: "small" | "medium" | "large" | "very large" | null;
  controls: string[];
  coordinates: [number, number, number, number] | null;
}

// Map TMU analysis names to database asset names
const ASSET_NAME_MAP: Record<string, string> = {
  // Exact matches
  "Electrical Rooms": "Electrical Rooms",
  "Mechanical Rooms": "Mechanical Rooms",
  "Electrical Risers": "Electrical Risers",
  "Main Electrical Risers": "Electrical Risers",
  "Mechanical Risers": "Mechanical Risers",
  "Elevator Pits": "Elevator Pits",
  "Suites": "Suites",
  "Guest Rooms": "Suites",
  "Suites/Guest Rooms": "Suites",
  "Kitchens & Washrooms": "Kitchens & Washrooms",
  "Facade, Envelope, Exterior, and Roofing": "Facade, Envelope, Exterior, and Roofing",
  "Mass Timber and Millwork": "Mass Timber and Millwork",
};

// Map TMU analysis names to database water system names
const WATER_SYSTEM_NAME_MAP: Record<string, string> = {
  // Cold Domestic Water variations
  "Cold Domestic Water": "Domestic Cold Water",
  "Cold Domestic Water: Main Entry": "Domestic Cold Water",
  "Cold Domestic Water: Main City Entry": "Domestic Cold Water",
  "Cold Domestic Water: Zone Entry": "Domestic Cold Water",
  "Cold Domestic Water: Suite Entry": "Domestic Cold Water",
  "Cold Domestic Water: Suite Riser Entry": "Domestic Cold Water",
  "Domestic Cold Water": "Domestic Cold Water",
  
  // Hot Domestic Water
  "Hot Domestic Water": "Domestic Hot Water",
  "Domestic Hot Water": "Domestic Hot Water",
  "Hot Water Return": "Domestic Hot Water",
  
  // Other systems
  "Temporary Water Run": "Temporary Water Run",
  "Main City Water Supply": "Main City Water Supply",
  "Main Water Entry": "Main City Water Supply",
  "Hydronics": "Hydronics",
  
  // Fire Suppression
  "Fire Suppression System": "Fire Suppression System",
  "Fire Protection": "Fire Suppression System",
  "FSP": "Fire Suppression System",
  
  // Sump/Drainage
  "Sump Pit, Storm Drain, and Drainage": "Sump Pits, Storm Drains, and Drainages",
  "Sump Pits, Storm Drains, and Drainages": "Sump Pits, Storm Drains, and Drainages",
  "Sump Pit": "Sump Pits, Storm Drains, and Drainages",
  "Storm Drain": "Sump Pits, Storm Drains, and Drainages",
  "Stormwater": "Sump Pits, Storm Drains, and Drainages",
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
  
  if (lowerName.includes("electrical room")) return "Electrical Rooms";
  if (lowerName.includes("mechanical room")) return "Mechanical Rooms";
  if (lowerName.includes("electrical riser")) return "Electrical Risers";
  if (lowerName.includes("mechanical riser")) return "Mechanical Risers";
  if (lowerName.includes("elevator pit")) return "Elevator Pits";
  if (lowerName.includes("suite") || lowerName.includes("guest room")) return "Suites";
  if (lowerName.includes("kitchen") || lowerName.includes("washroom") || lowerName.includes("w/c")) return "Kitchens & Washrooms";
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
  
  if (lowerName.includes("cold") && (lowerName.includes("domestic") || lowerName.includes("water"))) return "Domestic Cold Water";
  if (lowerName.includes("hot") && (lowerName.includes("domestic") || lowerName.includes("water"))) return "Domestic Hot Water";
  if (lowerName.includes("temporary") && lowerName.includes("water")) return "Temporary Water Run";
  if (lowerName.includes("main") && lowerName.includes("city") && lowerName.includes("water")) return "Main City Water Supply";
  if (lowerName.includes("hydronic")) return "Hydronics";
  if (lowerName.includes("fire") && (lowerName.includes("suppression") || lowerName.includes("protection") || lowerName.includes("sprinkler"))) return "Fire Suppression System";
  if (lowerName.includes("sump") || lowerName.includes("storm drain") || lowerName.includes("drainage")) return "Sump Pits, Storm Drains, and Drainages";
  
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
