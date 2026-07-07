import { AnalysisItem } from "./analysisItemMapper";
import { AWPOption } from "@/hooks/useAWPOptions";

/**
 * Generate the next available ID for a given class name using AWP options from DB
 */
export function generateNextIdFromOptions(
  className: string,
  awpOptions: AWPOption[],
  existingItems: AnalysisItem[]
): string {
  const awpOption = awpOptions.find((opt) => opt.name === className);
  const prefix = awpOption?.idPrefix;

  if (!prefix) {
    // Fallback for unknown classes: use first 3 uppercase letters + sequence
    const fallbackPrefix = className.replace(/[^a-zA-Z]/g, "").substring(0, 3).toUpperCase();
    const existingNumbers = existingItems
      .filter((item) => item.id.startsWith(fallbackPrefix))
      .map((item) => {
        const numPart = item.id.replace(fallbackPrefix, "");
        return parseInt(numPart, 10) || 0;
      });

    const maxNumber = Math.max(0, ...existingNumbers);
    const nextNumber = (maxNumber + 1).toString().padStart(3, "0");
    return `${fallbackPrefix}${nextNumber}`;
  }

  // Find all existing IDs with this prefix
  const existingNumbers = existingItems
    .filter((item) => item.id.startsWith(prefix))
    .map((item) => {
      const numPart = item.id.replace(prefix, "");
      return parseInt(numPart, 10) || 0;
    });

  const maxNumber = Math.max(0, ...existingNumbers);
  const nextNumber = (maxNumber + 1).toString().padStart(3, "0");

  return `${prefix}${nextNumber}`;
}

// Legacy hardcoded map - kept for backwards compatibility during transition
// TODO: Remove once all usages are migrated to use AWP options from DB
const LEGACY_CLASS_TO_PREFIX_MAP: Record<string, string> = {
  // Assets (legacy names)
  "Electrical Rooms": "ERM",
  "Electrical Room": "ERM",
  "Mechanical Rooms": "MRM",
  "Mechanical Room": "MRM",
  "Electrical Risers": "ERS",
  "Electrical Riser": "ERS",
  "Elevator Pits": "ELVP",
  "Elevator Pit": "ELVP",
  "Kitchens & Washrooms": "KW",
  "Kitchens & Washroom": "KW",
  "Facade, Envelope, Exterior, and Roofing": "FEER",
  "Mass Timber and Millwork": "MTM",
  Suite: "STE",
  Suites: "STE",
  // Water Systems
  "Cold Water": "CW",
  "Domestic Cold Water": "CW",
  "Hot Water": "HW",
  "Domestic Hot Water": "HW",
  "Sump Pits, Storm Drains and Drainages": "SPSDD",
  "Fire Suppression System": "FS",
  "Temporary Water Run": "TWR",
  Hydronics: "HYD",
  // Processes
  "Contractor Team": "CONT",
  "Water Mitigation Vendor Process": "WMVP",
  "Mechanical Contractor Process": "MCP",
  "Engineering Process": "ENGP",
};

/**
 * Legacy function - Generate the next available ID using hardcoded prefixes
 * @deprecated Use generateNextIdFromOptions instead
 */
export function generateNextId(className: string, existingItems: AnalysisItem[]): string {
  const prefix = LEGACY_CLASS_TO_PREFIX_MAP[className];

  if (!prefix) {
    // Fallback for unknown classes: use first 3 uppercase letters + sequence
    const fallbackPrefix = className.replace(/[^a-zA-Z]/g, "").substring(0, 3).toUpperCase();
    const existingNumbers = existingItems
      .filter((item) => item.id.startsWith(fallbackPrefix))
      .map((item) => {
        const numPart = item.id.replace(fallbackPrefix, "");
        return parseInt(numPart, 10) || 0;
      });

    const maxNumber = Math.max(0, ...existingNumbers);
    const nextNumber = (maxNumber + 1).toString().padStart(3, "0");
    return `${fallbackPrefix}${nextNumber}`;
  }

  // Find all existing IDs with this prefix
  const existingNumbers = existingItems
    .filter((item) => item.id.startsWith(prefix))
    .map((item) => {
      const numPart = item.id.replace(prefix, "");
      return parseInt(numPart, 10) || 0;
    });

  const maxNumber = Math.max(0, ...existingNumbers);
  const nextNumber = (maxNumber + 1).toString().padStart(3, "0");

  return `${prefix}${nextNumber}`;
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
