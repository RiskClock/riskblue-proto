import * as pdfjsLib from "pdfjs-dist";
import { findBBoxInTextLayer } from "@/lib/pdfTextLayerSearch";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url,
).toString();

export interface RiskRadarRow {
  key: string;
  identifier: string | null;
  label: string | null;
  level: string | null;
  notes: string | null;
}

export interface RiskRadarCandidate extends RiskRadarRow {
  /** Text that was found on the page, if any. */
  matchedText: string | null;
  nx: number | null;
  ny: number | null;
}

const isEmpty = (s: string | null | undefined) =>
  !s || /^(n\/?a|none|-+|unknown|not shown)$/i.test(s.trim());

/** Parse the markdown table Risk Radar returns into rows. */
export function parseRiskRadarTable(text: string | null | undefined): RiskRadarRow[] {
  if (!text) return [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith("|"));
  if (lines.length < 2) return [];
  const split = (l: string) => l.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  const header = split(lines[0]).map((h) => h.toLowerCase());
  const find = (re: RegExp) => header.findIndex((h) => re.test(h));
  const idIdx = (() => { const i = find(/identifier|tag|room/); return i >= 0 ? i : 0; })();
  const labelIdx = find(/label/);
  const levelIdx = find(/level|floor/);
  const notesIdx = find(/note/);
  const rows: RiskRadarRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = split(line);
    if (cells.every((c) => /^:?-+:?$/.test(c) || c === "")) continue;
    const get = (i: number) => (i >= 0 && !isEmpty(cells[i]) ? cells[i] : null);
    const identifier = get(idIdx);
    const label = labelIdx >= 0 ? get(labelIdx) : null;
    if (!identifier && !label) continue;
    rows.push({
      key: `${rows.length}`,
      identifier,
      label,
      level: get(levelIdx),
      notes: get(notesIdx),
    });
  }
  return rows;
}

/**
 * Look up each row on one PDF page: room identifier first, then the drawing
 * label. Returns normalized (0 to 1, top-left origin) centers for found rows.
 */
export async function locateRiskRadarRows(
  pdfBlob: Blob,
  pageNum: number,
  rows: RiskRadarRow[],
): Promise<RiskRadarCandidate[]> {
  const pdf = await pdfjsLib.getDocument({ data: await pdfBlob.arrayBuffer() }).promise;
  try {
    const page = await pdf.getPage(Math.min(Math.max(pageNum, 1), pdf.numPages));
    const vp = page.getViewport({ scale: 1 });
    const occurrences = new Map<string, number>();
    const out: RiskRadarCandidate[] = [];
    for (const row of rows) {
      let found: RiskRadarCandidate | null = null;
      for (const text of [row.identifier, row.label]) {
        if (!text) continue;
        const occ = occurrences.get(text.toLowerCase()) ?? 0;
        const bbox = await findBBoxInTextLayer(pdf, text, page.pageNumber, occ);
        if (!bbox || bbox.pageNum !== page.pageNumber) continue;
        occurrences.set(text.toLowerCase(), occ + 1);
        const [px, py] = vp.convertToViewportPoint((bbox.x1 + bbox.x2) / 2, (bbox.y1 + bbox.y2) / 2);
        found = {
          ...row,
          matchedText: text,
          nx: Math.min(1, Math.max(0, px / vp.width)),
          ny: Math.min(1, Math.max(0, py / vp.height)),
        };
        break;
      }
      out.push(found ?? { ...row, matchedText: null, nx: null, ny: null });
    }
    return out;
  } finally {
    void pdf.destroy();
  }
}
