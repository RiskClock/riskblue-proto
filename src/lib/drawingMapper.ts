/**
 * Maps item IDs to their static drawing image paths using ES6 imports for reliable PDF export
 */

// Import all drawings as ES6 modules for reliable PDF export
import drawingTWR001 from '/assets/drawings/TWR001.png';
import drawingDHWHWZE001 from '/assets/drawings/DHW-HWZE001.png';
import drawingDHWHWR001 from '/assets/drawings/DHW-HWR001.png';
import drawingDCWZE001 from '/assets/drawings/DCW-ZE001.png';
import drawingDCWME001 from '/assets/drawings/DCW-ME001.png';
import drawingDCWMCE001 from '/assets/drawings/DCW-MCE001.png';
import drawingFS001 from '/assets/drawings/FS001.png';
import drawingSPSDD001 from '/assets/drawings/SPSDD001.png';
import drawingSPSDD002 from '/assets/drawings/SPSDD002.png';
import drawingKW001 from '/assets/drawings/KW001.png';
import drawingKW002 from '/assets/drawings/KW002.png';
import drawingKW003 from '/assets/drawings/KW003.png';
import drawingKW004 from '/assets/drawings/KW004.png';
import drawingKW005 from '/assets/drawings/KW005.png';
import drawingKW006 from '/assets/drawings/KW006.png';
import drawingKW007 from '/assets/drawings/KW007.png';
import drawingKW008 from '/assets/drawings/KW008.png';
import drawingKW009 from '/assets/drawings/KW009.png';
import drawingKW010 from '/assets/drawings/KW010.png';
import drawingKW011 from '/assets/drawings/KW011.png';
import drawingKW012 from '/assets/drawings/KW012.png';
import drawingKW013 from '/assets/drawings/KW013.png';
import drawingKW014 from '/assets/drawings/KW014.png';
import drawingELVP001 from '/assets/drawings/ELVP001.png';
import drawingELVP002 from '/assets/drawings/ELVP002.png';
import drawingERS001 from '/assets/drawings/ERS001.png';
import drawingMRM001 from '/assets/drawings/MRM001.png';
import drawingERM001 from '/assets/drawings/ERM001.png';
import drawingERM002 from '/assets/drawings/ERM002.png';
import drawingERM003 from '/assets/drawings/ERM003.png';
import drawingERM004 from '/assets/drawings/ERM004.png';
import drawingERM005 from '/assets/drawings/ERM005.png';
import drawingERM006 from '/assets/drawings/ERM006.png';

const DRAWING_IMAGES: Record<string, string> = {
  // Temporary Water Run
  'TWR001': drawingTWR001,
  
  // Domestic Hot Water
  'DHW-HWZE001': drawingDHWHWZE001,
  'DHW-HWR001': drawingDHWHWR001,
  'DHW-ZE001': drawingDHWHWZE001, // Alias
  
  // Domestic Cold Water
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
