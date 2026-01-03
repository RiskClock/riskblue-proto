import { AnalysisItem } from "./analysisItemMapper";

// Map class names to their ID prefixes
export const CLASS_TO_PREFIX_MAP: Record<string, string> = {
  // Assets
  "Electrical Rooms": "ERM",
  "Mechanical Rooms": "MRM",
  "Electrical Risers": "ERS",
  "Elevator Pits": "ELVP",
  "Kitchens & Washrooms": "KW",
  "Facade, Envelope, Exterior, and Roofing": "FEER",
  "Mass Timber and Millwork": "MTM",
  // Water Systems
  "Domestic Cold Water: Main City Entry": "DCW-MCE",
  "Domestic Cold Water: Main Entry": "DCW-ME",
  "Domestic Cold Water: Zone Entry": "DCW-ZE",
  "Domestic Hot Water: Hot Water Return": "DHW-HWR",
  "Domestic Hot Water: Zone Entry": "DHW-HWZE",
  "Sump Pit, Storm Drain, and Drainage": "SPSDD",
  "Fire Suppression System": "FS",
  "Temporary Water Run": "TWR",
  // Processes
  "Contractor Team": "CT",
  "Water Mitigation Vendor": "WMV",
  "Mechanical Contractor and Engineering": "MCE",
};

// Map class names to categories
export const CLASS_TO_CATEGORY_MAP: Record<string, "Asset" | "Water System" | "Process"> = {
  // Assets
  "Electrical Rooms": "Asset",
  "Mechanical Rooms": "Asset",
  "Electrical Risers": "Asset",
  "Elevator Pits": "Asset",
  "Kitchens & Washrooms": "Asset",
  "Facade, Envelope, Exterior, and Roofing": "Asset",
  "Mass Timber and Millwork": "Asset",
  // Water Systems
  "Domestic Cold Water: Main City Entry": "Water System",
  "Domestic Cold Water: Main Entry": "Water System",
  "Domestic Cold Water: Zone Entry": "Water System",
  "Domestic Hot Water: Hot Water Return": "Water System",
  "Domestic Hot Water: Zone Entry": "Water System",
  "Sump Pit, Storm Drain, and Drainage": "Water System",
  "Fire Suppression System": "Water System",
  "Temporary Water Run": "Water System",
  // Processes
  "Contractor Team": "Process",
  "Water Mitigation Vendor": "Process",
  "Mechanical Contractor and Engineering": "Process",
};

// Group classes by category for the dropdown
export const CLASSES_BY_CATEGORY = {
  Asset: [
    "Electrical Rooms",
    "Mechanical Rooms",
    "Electrical Risers",
    "Elevator Pits",
    "Kitchens & Washrooms",
    "Facade, Envelope, Exterior, and Roofing",
    "Mass Timber and Millwork",
  ],
  "Water System": [
    "Domestic Cold Water: Main City Entry",
    "Domestic Cold Water: Main Entry",
    "Domestic Cold Water: Zone Entry",
    "Domestic Hot Water: Hot Water Return",
    "Domestic Hot Water: Zone Entry",
    "Sump Pit, Storm Drain, and Drainage",
    "Fire Suppression System",
    "Temporary Water Run",
  ],
  Process: [
    "Contractor Team",
    "Water Mitigation Vendor",
    "Mechanical Contractor and Engineering",
  ],
};

/**
 * Generate the next available ID for a given class name
 */
export function generateNextId(className: string, existingItems: AnalysisItem[]): string {
  const prefix = CLASS_TO_PREFIX_MAP[className];
  
  if (!prefix) {
    // Fallback for unknown classes: use first 3 uppercase letters + sequence
    const fallbackPrefix = className.replace(/[^a-zA-Z]/g, '').substring(0, 3).toUpperCase();
    const existingNumbers = existingItems
      .filter(item => item.id.startsWith(fallbackPrefix))
      .map(item => {
        const numPart = item.id.replace(fallbackPrefix, '');
        return parseInt(numPart, 10) || 0;
      });
    
    const maxNumber = Math.max(0, ...existingNumbers);
    const nextNumber = (maxNumber + 1).toString().padStart(3, '0');
    return `${fallbackPrefix}${nextNumber}`;
  }
  
  // Find all existing IDs with this prefix
  const existingNumbers = existingItems
    .filter(item => item.id.startsWith(prefix))
    .map(item => {
      const numPart = item.id.replace(prefix, '');
      return parseInt(numPart, 10) || 0;
    });
  
  const maxNumber = Math.max(0, ...existingNumbers);
  const nextNumber = (maxNumber + 1).toString().padStart(3, '0');
  
  return `${prefix}${nextNumber}`;
}

/**
 * Get the category for a given class name
 */
export function getCategoryForClass(className: string): "Asset" | "Water System" | "Process" | null {
  return CLASS_TO_CATEGORY_MAP[className] || null;
}

/**
 * Check if a class is an Asset (has size field)
 */
export function isAssetClass(className: string): boolean {
  return CLASS_TO_CATEGORY_MAP[className] === "Asset";
}

/**
 * Check if a class is a Water System (has pipe diameter field)
 */
export function isWaterSystemClass(className: string): boolean {
  return CLASS_TO_CATEGORY_MAP[className] === "Water System";
}

/**
 * Unit conversion helpers
 */
export function sqftToSqm(sqft: number): number {
  return sqft * 0.092903;
}

export function sqmToSqft(sqm: number): number {
  return sqm / 0.092903;
}

export function inchesToMm(inches: number): number {
  return inches * 25.4;
}

export function mmToInches(mm: number): number {
  return mm / 25.4;
}
