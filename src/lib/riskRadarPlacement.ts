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

const clean = (s: string | null | undefined) => {
  if (s == null) return null;
  const t = s.replace(/\*\*|__|`/g, "").replace(/^["'\s]+|["'\s.;,]+$/g, "").trim();
  return isEmpty(t) ? null : t;
};

function parseTable(text: string): RiskRadarRow[] {
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
    const get = (i: number) => (i >= 0 ? clean(cells[i]) : null);
    const identifier = get(idIdx);
    const label = labelIdx >= 0 ? get(labelIdx) : null;
    if (!identifier && !label) continue;
    rows.push({ key: `${rows.length}`, identifier, label, level: get(levelIdx), notes: get(notesIdx) });
  }
  return rows;
}

type Field = "identifier" | "label" | "level" | "notes";
const fieldFor = (key: string): Field | null => {
  const k = key.toLowerCase();
  if (/identifier|tag|room\s*(no|number|id|code)?$|^id$|^room$/.test(k)) return "identifier";
  if (/label|name|title|description/.test(k)) return "label";
  if (/level|floor/.test(k)) return "level";
  if (/note|comment/.test(k)) return "notes";
  return null;
};
const KV = /^(?:[-*•+]|\d+[.)])?\s*\**([A-Za-z][A-Za-z /()]{0,60}?)\**\s*[:=]\s*(.+)$/;
const BULLET = /^(?:[-*•+]|\d+[.)])\s+/;

/** Bulleted / numbered / plain-text lists, either key:value blocks or one record per line. */
function parseList(text: string): RiskRadarRow[] {
  const rows: RiskRadarRow[] = [];
  let cur: Partial<Record<Field, string | null>> | null = null;
  const flush = () => {
    if (cur && (cur.identifier || cur.label)) {
      rows.push({ key: `${rows.length}`, identifier: cur.identifier ?? null, label: cur.label ?? null, level: cur.level ?? null, notes: cur.notes ?? null });
    }
    cur = null;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    if (/^#+\s/.test(line) || /no (results|detections|elements)/i.test(line)) { flush(); continue; }
    const isBullet = BULLET.test(line) && !/^\s{2,}/.test(raw);
    const kv = line.match(KV);
    const field = kv ? fieldFor(kv[1]) : null;
    if (kv && field) {
      if (isBullet && cur && cur[field]) flush();
      if (!cur) cur = {};
      if (cur[field]) { flush(); cur = {}; }
      cur[field] = clean(kv[2]);
      continue;
    }
    if (kv && !field) continue; // unrelated key (file name, size, sheet)
    // Single-line record: "SWC-B04 - Electrical Room (Level 1)" or "SWC-B04 | Electrical Room | L1"
    const body = line.replace(BULLET, "");
    if (!isBullet && !/[|–—-]/.test(body)) continue;
    flush();
    const parts = body.split(/\s*\|\s*|\s+[–—-]\s+|:\s+/).map((p) => clean(p)).filter(Boolean) as string[];
    if (parts.length === 0) continue;
    let level: string | null = null;
    const last = parts[parts.length - 1];
    const paren = last.match(/^(.*?)\s*\(([^)]*(level|floor|lvl|basement)[^)]*)\)$/i);
    if (paren) { parts[parts.length - 1] = paren[1]; level = paren[2]; }
    else if (parts.length > 2 && /level|floor|lvl|basement/i.test(last)) { level = parts.pop()!; }
    const looksId = (s: string) => /\d/.test(s) && !/\s{1}\w+\s+\w+/.test(s) && s.length <= 20;
    const identifier = parts.length > 1 && looksId(parts[0]) ? parts[0] : null;
    const label = identifier ? parts[1] ?? null : parts[0];
    rows.push({ key: `${rows.length}`, identifier, label: clean(label), level: clean(level), notes: null });
  }
  flush();
  return rows;
}

/** Parse Risk Radar output (markdown table, bulleted list, or plain text) into rows. */
export function parseRiskRadarTable(text: string | null | undefined): RiskRadarRow[] {
  if (!text) return [];
  const table = parseTable(text);
  if (table.length > 0) return table;
  return parseList(text);
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
