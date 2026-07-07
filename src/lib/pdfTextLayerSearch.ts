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

type PdfTextItem = { str: string; transform: number[]; width: number; height: number };
type MatchedItem = PdfTextItem & { __pageNum: number };

/**
 * Collect all exact text-layer matches on a single page (Pass 1: single-item;
 * Pass 2: cross-item concat on the same line). Returns matches in document order.
 */
function collectExactMatchesOnPage(items: PdfTextItem[], normTag: string): PdfTextItem[] {
  const matches: PdfTextItem[] = [];

  // Pass 1: exact single-item match (track all occurrences)
  for (const item of items) {
    if (normalizeText(item.str) === normTag) {
      matches.push(item);
    }
  }

  // Pass 2: tag split across consecutive items on the same line
  for (let i = 0; i < items.length - 1; i++) {
    let concat = "";
    const spanItems: PdfTextItem[] = [];
    for (let j = i; j < Math.min(i + 4, items.length); j++) {
      const baseY = items[i].transform[5];
      const curY = items[j].transform[5];
      if (Math.abs(curY - baseY) > 4) break;
      concat += items[j].str;
      spanItems.push(items[j]);
      if (normalizeText(concat) === normTag) {
        const [sx1] = itemBBox(spanItems[0]);
        const [, , sx2] = itemBBox(spanItems[spanItems.length - 1]);
        // Skip if Pass 1 already captured the same position (single-item match
        // would be equal to a 1-span concat).
        const already = matches.some(
          (m) => m.transform[4] === spanItems[0].transform[4] && m.transform[5] === spanItems[0].transform[5],
        );
        if (!already) {
          matches.push({ ...items[i], width: sx2 - sx1 });
        }
        break;
      }
    }
  }

  // Sort by document order (top-to-bottom, then left-to-right). PDF y is
  // bottom-up, so larger y comes first.
  matches.sort((a, b) => {
    const dy = b.transform[5] - a.transform[5];
    if (Math.abs(dy) > 4) return dy;
    return a.transform[4] - b.transform[4];
  });

  return matches;
}

/** Last-resort substring fallback (no occurrence support - used only when zero exact matches). */
function findSubstringFallback(items: PdfTextItem[], normTag: string): PdfTextItem | null {
  if (normTag.length <= 15) return null;
  let bestLen = 0;
  let best: PdfTextItem | null = null;
  for (const item of items) {
    const normItem = normalizeText(item.str);
    if (normItem.length < 4) continue;
    if (normTag.includes(normItem) && normItem.length > bestLen) {
      bestLen = normItem.length;
      best = item;
    }
  }
  return best;
}

/**
 * Search all pages of a loaded PDF document for the exact room tag string.
 *
 * @param occurrenceIndex 0-based index of the occurrence to return when the tag
 *   appears multiple times. Order: hint page first (if provided), then pages
 *   1..N; within a page, top-to-bottom then left-to-right. Defaults to 0 (first).
 *   If fewer exact matches than `occurrenceIndex+1` exist, returns the last
 *   exact match and logs a warning.
 */
export async function findBBoxInTextLayer(
  pdf: pdfjsLib.PDFDocumentProxy,
  primaryTag: string,
  hintPageNum?: number,
  occurrenceIndex: number = 0,
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

  // Collect exact matches across pages until we have enough to satisfy the
  // requested occurrence index (or we exhaust the document).
  const allExact: MatchedItem[] = [];
  const pagesItems = new Map<number, PdfTextItem[]>();
  for (const pageNum of pageOrder) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const items = textContent.items as PdfTextItem[];
    pagesItems.set(pageNum, items);
    const pageMatches = collectExactMatchesOnPage(items, normTag);
    for (const m of pageMatches) allExact.push({ ...m, __pageNum: pageNum });
    if (allExact.length > occurrenceIndex) break;
  }

  let matchedItem: PdfTextItem | null = null;
  let matchedPage: number | null = null;

  if (allExact.length > 0) {
    let idx = occurrenceIndex;
    if (idx >= allExact.length) {
      console.warn(
        `[pdfTextLayerSearch] requested occurrence ${occurrenceIndex} of "${primaryTag}" but only ${allExact.length} exact matches; using last.`,
      );
      idx = allExact.length - 1;
    }
    const chosen = allExact[idx];
    matchedItem = chosen;
    matchedPage = chosen.__pageNum;
  } else {
    // Substring fallback: scan all pages we haven't fetched yet, then return
    // the first viable hit. Only used when there are zero exact matches.
    for (const pageNum of pageOrder) {
      let items = pagesItems.get(pageNum);
      if (!items) {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        items = textContent.items as PdfTextItem[];
        pagesItems.set(pageNum, items);
      }
      const sub = findSubstringFallback(items, normTag);
      if (sub) {
        matchedItem = sub;
        matchedPage = pageNum;
        break;
      }
    }
  }

  if (!matchedItem || matchedPage == null) return null;

  // Compute base bbox from the matched tag item
  const [mx1, my1, mx2, my2] = itemBBox(matchedItem);
  const tagCentreX = (mx1 + mx2) / 2;
  const tagCentreY = (my1 + my2) / 2;

  // --- Pass 3: find the nearest room-name line within ±60 pts vertically ---
  // Scope room-name expansion to the matched page only.
  const items = pagesItems.get(matchedPage) ?? [];
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
    pageNum: matchedPage,
  };
}
