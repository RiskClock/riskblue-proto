// Normalizes a Scout agent raw response. Older runs persisted each Gemini
// chunk separated by "--- pages X-Y ---" markers; this merges them into a
// single pretty-printed JSON array grouped by file_name with concatenated
// surveyed_pages. Newer runs already store a clean JSON array — those pass
// through unchanged.

type SurveyFile = {
  file_name: string;
  total_pages?: number;
  surveyed_pages?: any[];
};

function stripFence(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

function tryParseJsonArray(text: string): any[] | null {
  const t = stripFence(text);
  try {
    const d = JSON.parse(t);
    if (Array.isArray(d)) return d;
  } catch {}
  const s = t.indexOf("[");
  const e = t.lastIndexOf("]");
  if (s >= 0 && e > s) {
    try {
      const d = JSON.parse(t.slice(s, e + 1));
      if (Array.isArray(d)) return d;
    } catch {}
  }
  return null;
}

export function normalizeScoutResponse(raw: string | null | undefined): string {
  if (!raw) return "";
  const text = String(raw);
  const hasChunkMarkers = /---\s*pages\s+\d+\s*[-–]\s*\d+\s*---/i.test(text);

  // Fast path: already a clean JSON array.
  if (!hasChunkMarkers) {
    const direct = tryParseJsonArray(text);
    if (direct) return JSON.stringify(direct, null, 2);
    return text;
  }

  // Split on chunk markers and parse each piece.
  const parts = text.split(/---\s*pages\s+\d+\s*[-–]\s*\d+\s*---/i);
  const chunks: any[] = [];
  for (const p of parts) {
    if (!p.trim()) continue;
    const arr = tryParseJsonArray(p);
    if (arr) chunks.push(...arr);
  }
  if (chunks.length === 0) return text;

  const byFile = new Map<string, SurveyFile>();
  const order: string[] = [];
  const seen = new Map<string, Set<number>>();
  for (const item of chunks) {
    const fname = String(item?.file_name ?? "unknown");
    if (!byFile.has(fname)) {
      byFile.set(fname, { file_name: fname, total_pages: 0, surveyed_pages: [] });
      seen.set(fname, new Set());
      order.push(fname);
    }
    const bucket = byFile.get(fname)!;
    const tp = Number(item?.total_pages);
    if (Number.isFinite(tp) && tp > (bucket.total_pages ?? 0)) bucket.total_pages = tp;
    const pages = Array.isArray(item?.surveyed_pages) ? item.surveyed_pages : [];
    const seenSet = seen.get(fname)!;
    for (const pg of pages) {
      const pn = Number(pg?.page_number);
      if (Number.isFinite(pn)) {
        if (seenSet.has(pn)) continue;
        seenSet.add(pn);
      }
      bucket.surveyed_pages!.push(pg);
    }
  }
  for (const b of byFile.values()) {
    b.surveyed_pages!.sort((a: any, b: any) => {
      const pa = Number(a?.page_number); const pb = Number(b?.page_number);
      if (!Number.isFinite(pa) || !Number.isFinite(pb)) return 0;
      return pa - pb;
    });
  }
  return JSON.stringify(order.map((n) => byFile.get(n)!), null, 2);
}
