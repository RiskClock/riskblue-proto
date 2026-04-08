import * as pdfjsLib from "pdfjs-dist";

// ---------------------------------------------------------------------------
// Deterministic BBox from pdf.js text layer (shared utility)
// ---------------------------------------------------------------------------

export interface PDFBBox {
  x1: number; // PDF user space (pts, bottom-left origin)
  y1: number;
  x2: number;
  y2: number;
  pageNum: number;
}

/** Normalize a PDF text item string for matching: case-fold, trim, collapse whitespace,
 *  and normalize all hyphen/dash variants to ASCII hyphen. */
export function normalizeText(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\uFE58\uFE63\uFF0D]/g, "-")
    .replace(/[\u00D8\u00F8\u2205\u2300]/g, "o")
    .replace(/\s+/g, " ");
}

/**
 * Compute a bbox from a single text item's transform matrix.
 * Returns [x1, y1, x2, y2] in PDF user space (bottom-left origin).
 */
export function itemBBox(item: { transform: number[]; width: number; height: number }): [number, number, number, number] {
  const [, , , , tx, ty] = item.transform;
  const iw = Math.abs(item.width);
  const ih = Math.abs(item.height) || 10;
  return [tx, ty, tx + iw, ty + ih];
}

const ROOM_NAME_KEYWORDS = [
  "electrical", "substation", "it room", "telecom", "transformer",
  "generator", "switchgear", "mdf", "idf", "ups", "power",
];

/**
 * Search all pages of a loaded PDF document for the exact room tag string.
 */
export async function findBBoxInTextLayer(
  pdf: pdfjsLib.PDFDocumentProxy,
  primaryTag: string,
  hintPageNum?: number
): Promise<PDFBBox | null> {
  const normTag = normalizeText(primaryTag);
  if (!normTag || normTag.length < 2) return null;

  const pageOrder: number[] = [];
  if (hintPageNum && hintPageNum >= 1 && hintPageNum <= pdf.numPages) {
    pageOrder.push(hintPageNum);
  }
  for (let i = 1; i <= pdf.numPages; i++) {
    if (!pageOrder.includes(i)) pageOrder.push(i);
  }

  for (const pageNum of pageOrder) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const items = textContent.items as Array<{
      str: string;
      transform: number[];
      width: number;
      height: number;
    }>;

    // --- Pass 1: exact single-item match ---
    let matchedItem: typeof items[0] | null = null;
    for (const item of items) {
      if (normalizeText(item.str) === normTag) {
        matchedItem = item;
        break;
      }
    }

    // --- Pass 2: tag split across consecutive items on the same line ---
    if (!matchedItem) {
      for (let i = 0; i < items.length - 1; i++) {
        let concat = "";
        let spanItems: typeof items = [];
        for (let j = i; j < Math.min(i + 4, items.length); j++) {
          const baseY = items[i].transform[5];
          const curY = items[j].transform[5];
          if (Math.abs(curY - baseY) > 4) break;
          concat += items[j].str;
          spanItems.push(items[j]);
          if (normalizeText(concat) === normTag) {
            matchedItem = items[i];
            const [sx1] = itemBBox(spanItems[0]);
            const [,, sx2] = itemBBox(spanItems[spanItems.length - 1]);
            matchedItem = {
              ...items[i],
              width: sx2 - sx1,
            };
            break;
          }
        }
        if (matchedItem) break;
      }
    }

    // --- Pass 2.5: substring matching for long labels ---
    if (!matchedItem && normTag.length > 15) {
      let bestLen = 0;
      for (const item of items) {
        const normItem = normalizeText(item.str);
        if (normItem.length < 4) continue;
        if (normTag.includes(normItem) && normItem.length > bestLen) {
          bestLen = normItem.length;
          matchedItem = item;
        }
      }
    }

    if (!matchedItem) continue;

    // Compute base bbox from the matched tag item
    const [mx1, my1, mx2, my2] = itemBBox(matchedItem);
    const tagCentreX = (mx1 + mx2) / 2;
    const tagCentreY = (my1 + my2) / 2;

    // --- Pass 3: find the nearest room-name line within ±60 pts vertically ---
    let rnx1 = mx1, rny1 = my1, rnx2 = mx2, rny2 = my2;
    let foundRoomName = false;
    let bestDist = Infinity;

    for (const item of items) {
      const norm = normalizeText(item.str);
      if (!ROOM_NAME_KEYWORDS.some((kw) => norm.includes(kw))) continue;
      const [ix1, iy1, ix2, iy2] = itemBBox(item);
      const iCentreX = (ix1 + ix2) / 2;
      const iCentreY = (iy1 + iy2) / 2;
      const dy = Math.abs(iCentreY - tagCentreY);
      const dx = Math.abs(iCentreX - tagCentreX);
      if (dy > 60 || dx > 80) continue;
      if (dy < bestDist) {
        bestDist = dy;
        rnx1 = Math.min(mx1, ix1);
        rny1 = Math.min(my1, iy1);
        rnx2 = Math.max(mx2, ix2);
        rny2 = Math.max(my2, iy2);
        foundRoomName = true;
      }
    }

    const PAD = 4;
    return {
      x1: (foundRoomName ? rnx1 : mx1) - PAD,
      y1: (foundRoomName ? rny1 : my1) - PAD,
      x2: (foundRoomName ? rnx2 : mx2) + PAD,
      y2: (foundRoomName ? rny2 : my2) + PAD,
      pageNum,
    };
  }

  return null;
}
