/**
 * Maps item IDs to their static drawing image paths
 */
const DRAWING_IMAGES: Record<string, string> = {
  // Temporary Water Run
  'TWR001': '/assets/drawings/TWR001.png',
  
  // Domestic Hot Water
  'DHW-HWZE001': '/assets/drawings/DHW-HWZE001.png',
  'DHW-HWR001': '/assets/drawings/DHW-HWR001.png',
  'DHW-ZE001': '/assets/drawings/DHW-ZE001.png',
  
  // Domestic Cold Water
  'DCW-ZE001': '/assets/drawings/DCW-ZE001.png',
  'DCW-ME001': '/assets/drawings/DCW-ME001.png',
  'DCW-MCE001': '/assets/drawings/DCW-MCE001.png',
  
  // Fire Suppression
  'FS001': '/assets/drawings/FS001.png',
  
  // Sump Pits, Storm Drains and Drainages
  'SPSDD001': '/assets/drawings/SPSDD001.png',
  'SPSDD002': '/assets/drawings/SPSDD002.png',
  
  // Kitchens & Washrooms
  'KW004': '/assets/drawings/KW004.png',
  'KW005': '/assets/drawings/KW005.png',
  'KW006': '/assets/drawings/KW006.png',
  'KW007': '/assets/drawings/KW007.png',
  'KW008': '/assets/drawings/KW008.png',
  'KW009': '/assets/drawings/KW009.png',
  'KW010': '/assets/drawings/KW010.png',
  'KW011': '/assets/drawings/KW011.png',
  'KW012': '/assets/drawings/KW012.png',
  'KW013': '/assets/drawings/KW013.png',
  'KW014': '/assets/drawings/KW014.png',
};

/**
 * Get the static drawing image path for an item ID
 * @param itemId The item ID (e.g., 'ERM001', 'DCW-ZE001')
 * @returns The path to the drawing image, or null if not available
 */
export function getDrawingImage(itemId: string): string | null {
  return DRAWING_IMAGES[itemId] || null;
}

/**
 * Check if a drawing exists for an item ID
 * @param itemId The item ID
 * @returns true if a drawing exists
 */
export function hasDrawing(itemId: string): boolean {
  return itemId in DRAWING_IMAGES;
}

/**
 * Add a new drawing to the mapper (for dynamic updates)
 * @param itemId The item ID
 * @param path The path to the drawing image
 */
export function registerDrawing(itemId: string, path: string): void {
  DRAWING_IMAGES[itemId] = path;
}
