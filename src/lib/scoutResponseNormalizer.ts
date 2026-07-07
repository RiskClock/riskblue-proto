// Normalizes a Scout agent raw response. Older runs persisted each Gemini
// chunk separated by "--- pages X-Y ---" markers; this concatenates the
// parsed arrays from each chunk into a single JSON array (no merging,
// dedupe, or sorting). Newer runs already store a clean JSON array - those
// pass through (re-pretty-printed).

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

  if (!hasChunkMarkers) {
    const direct = tryParseJsonArray(text);
    if (direct) return JSON.stringify(direct, null, 2);
    return text;
  }

  const parts = text.split(/---\s*pages\s+\d+\s*[-–]\s*\d+\s*---/i);
  const combined: any[] = [];
  for (const p of parts) {
    if (!p.trim()) continue;
    const arr = tryParseJsonArray(p);
    if (arr) combined.push(...arr);
  }
  if (combined.length === 0) return text;
  return JSON.stringify(combined, null, 2);
}
