/**
 * Maps item IDs to their static drawing image paths using ES6 imports for reliable PDF export
 */

// Import all drawings as ES6 modules for reliable PDF export
const drawingTWR001 = '/assets/drawings/TWR001.png';
const drawingDCW001 = '/assets/drawings/DCW001.png';
const drawingDCW002 = '/assets/drawings/DCW002.png';
const drawingDCW003 = '/assets/drawings/DCW003.png';
const drawingDHW001 = '/assets/drawings/DHW001.png';
const drawingDHW002 = '/assets/drawings/DHW002.png';
const drawingDHWHWZE001 = '/assets/drawings/DHW-HWZE001.png';
const drawingDHWHWR001 = '/assets/drawings/DHW-HWR001.png';
const drawingDCWZE001 = '/assets/drawings/DCW-ZE001.png';
const drawingDCWME001 = '/assets/drawings/DCW-ME001.png';
const drawingDCWMCE001 = '/assets/drawings/DCW-MCE001.png';
const drawingFS001 = '/assets/drawings/FS001.png';
const drawingSPSDD001 = '/assets/drawings/SPSDD001.png';
const drawingSPSDD002 = '/assets/drawings/SPSDD002.png';
const drawingKW001 = '/assets/drawings/KW001.png';
const drawingKW002 = '/assets/drawings/KW002.png';
const drawingKW003 = '/assets/drawings/KW003.png';
const drawingKW004 = '/assets/drawings/KW004.png';
const drawingKW005 = '/assets/drawings/KW005.png';
const drawingKW006 = '/assets/drawings/KW006.png';
const drawingKW007 = '/assets/drawings/KW007.png';
const drawingKW008 = '/assets/drawings/KW008.png';
const drawingKW009 = '/assets/drawings/KW009.png';
const drawingKW010 = '/assets/drawings/KW010.png';
const drawingKW011 = '/assets/drawings/KW011.png';
const drawingKW012 = '/assets/drawings/KW012.png';
const drawingKW013 = '/assets/drawings/KW013.png';
const drawingKW014 = '/assets/drawings/KW014.png';
const drawingELVP001 = '/assets/drawings/ELVP001.png';
const drawingELVP002 = '/assets/drawings/ELVP002.png';
const drawingERS001 = '/assets/drawings/ERS001.png';
const drawingMRM001 = '/assets/drawings/MRM001.png';
const drawingERM001 = '/assets/drawings/ERM001.png';
const drawingERM002 = '/assets/drawings/ERM002.png';
const drawingERM003 = '/assets/drawings/ERM003.png';
const drawingERM004 = '/assets/drawings/ERM004.png';
const drawingERM005 = '/assets/drawings/ERM005.png';
const drawingERM006 = '/assets/drawings/ERM006.png';

const DRAWING_IMAGES: Record<string, string> = {
  // Temporary Water Run
  'TWR001': drawingTWR001,
  
  // Domestic Hot Water
  'DHW001': drawingDHW001,
  'DHW002': drawingDHW002,
  'DHW-HWZE001': drawingDHWHWZE001,
  'DHW-HWR001': drawingDHWHWR001,
  'DHW-ZE001': drawingDHWHWZE001, // Alias
  
  // Domestic Cold Water
  'DCW001': drawingDCW001,
  'DCW002': drawingDCW002,
  'DCW003': drawingDCW003,
  'DCW-ZE001': drawingDCWZE001,
  'DCW-ME001': drawingDCWME001,
  'DCW-MCE001': drawingDCWMCE001,
  
  // Fire Suppression
  'FS001': drawingFS001,
  
  // Sump Pits, Storm Drains and Drainages
  'SPSDD001': drawingSPSDD001,
  'SPSDD002': drawingSPSDD002,
  
  // Kitchens & Washrooms
  'KW001': drawingKW001,
  'KW002': drawingKW002,
  'KW003': drawingKW003,
  'KW004': drawingKW004,
  'KW005': drawingKW005,
  'KW006': drawingKW006,
  'KW007': drawingKW007,
  'KW008': drawingKW008,
  'KW009': drawingKW009,
  'KW010': drawingKW010,
  'KW011': drawingKW011,
  'KW012': drawingKW012,
  'KW013': drawingKW013,
  'KW014': drawingKW014,
  
  // Elevator Pits
  'ELVP001': drawingELVP001,
  'ELVP002': drawingELVP002,
  
  // Electrical Riser Shafts
  'ERS001': drawingERS001,
  
  // Mechanical Room
  'MRM001': drawingMRM001,
  
  // Electrical Rooms
  'ERM001': drawingERM001,
  'ERM002': drawingERM002,
  'ERM003': drawingERM003,
  'ERM004': drawingERM004,
  'ERM005': drawingERM005,
  'ERM006': drawingERM006,
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
