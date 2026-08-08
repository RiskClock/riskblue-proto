// Parse the raw text returned by the survey-pages agent into a structured
// list of floor-plan items keyed by source page number.

export type FloorPlanType =
  | "level_floor_plan"
  | "unit_floor_plan"
  | "schematic_level_row"
  | "typical_detail_block"
  | "master_plan"
  | string;

export interface ParsedFloorPlan {
  plan_id: string;
  type: FloorPlanType;
  reference_id: string | null;
  /** [left, top, width, height] as percentages (0..100) of the visible page. */
  xy_width_height_pct: [number, number, number, number] | null;
  /**
   * Optional irregular polygon outline as [[x, y], ...] percentages (0..100)
   * of the visible page. When present with >= 3 points it supersedes the
   * rectangle for rendering and containment; `xy_width_height_pct` stays in
   * sync as the polygon's bounding envelope.
   */
  points_pct?: [number, number][] | null;
  page_number: number;
  floors: string[];
  referenced_unit_ids: string[];
}


function stripCodeFence(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
}

function tryParse(text: string): any {
  const stripped = stripCodeFence(text);
  try {
    return JSON.parse(stripped);
  } catch {
    const s = stripped.indexOf("[");
    const e = stripped.lastIndexOf("]");
    if (s >= 0 && e > s) {
      try { return JSON.parse(stripped.slice(s, e + 1)); } catch { /* */ }
    }
    return null;
  }
}

/**
 * Older scout responses persisted Gemini chunks separated by
 * `--- pages X-Y ---` markers. Parse each chunk separately and concatenate
 * into a single array so legacy data still produces floor-plan badges.
 */
function parseChunkedSurvey(text: string): any[] | null {
  if (!/---\s*pages\s+\d+\s*[-–]\s*\d+\s*---/i.test(text)) return null;
  const parts = text.split(/---\s*pages\s+\d+\s*[-–]\s*\d+\s*---/i);
  const combined: any[] = [];
  for (const p of parts) {
    if (!p.trim()) continue;
    const parsed = tryParse(p);
    if (Array.isArray(parsed)) combined.push(...parsed);
    else if (parsed) combined.push(parsed);
  }
  return combined.length > 0 ? combined : null;
}


function asStringArr(v: any): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === "string" ? x : String(x ?? ""))).filter(Boolean);
}

function asBbox(v: any): [number, number, number, number] | null {
  if (!Array.isArray(v) || v.length < 4) return null;
  const nums = v.slice(0, 4).map((n) => Number(n));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  return nums as [number, number, number, number];
}

/** Parse an optional polygon outline: [[x, y], ...] in page percentages. */
export function asPointsPct(v: any): [number, number][] | null {
  if (!Array.isArray(v) || v.length < 3) return null;
  const out: [number, number][] = [];
  for (const p of v) {
    let x: number, y: number;
    if (Array.isArray(p) && p.length >= 2) {
      x = Number(p[0]);
      y = Number(p[1]);
    } else if (p && typeof p === "object") {
      x = Number((p as any).x);
      y = Number((p as any).y);
    } else return null;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    out.push([x, y]);
  }
  return out.length >= 3 ? out : null;
}

/** Envelope [x, y, w, h] (pct) of a polygon. */
export function envelopeOfPointsPct(
  points: [number, number][],
): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX)) return [0, 0, 0, 0];
  return [minX, minY, Math.max(0, maxX - minX), Math.max(0, maxY - minY)];
}

/** Corners of a [x, y, w, h] pct rect, clockwise from top-left. */
export function rectToPointsPct(
  bb: [number, number, number, number],
): [number, number][] {
  const [x, y, w, h] = bb;
  return [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
}

/** Ray-casting containment test in pct space. */
export function pointInPolygonPct(
  x: number,
  y: number,
  points: [number, number][],
): boolean {
  if (!points || points.length < 3) return false;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i][0], yi = points[i][1];
    const xj = points[j][0], yj = points[j][1];
    const intersects =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Shoelace area (pct^2) of a polygon. */
export function polygonAreaPct(points: [number, number][]): number {
  if (!points || points.length < 3) return 0;
  let sum = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    sum += (points[j][0] + points[i][0]) * (points[j][1] - points[i][1]);
  }
  return Math.abs(sum / 2);
}


function flattenPages(parsed: any): any[] {
  if (!parsed) return [];
  if (Array.isArray(parsed)) {
    // [{ surveyed_pages: [...] }] or [page, page, ...]
    const out: any[] = [];
    for (const item of parsed) {
      if (item && Array.isArray(item.surveyed_pages)) out.push(...item.surveyed_pages);
      else out.push(item);
    }
    return out;
  }
  if (parsed && Array.isArray(parsed.surveyed_pages)) return parsed.surveyed_pages;
  if (parsed && typeof parsed === "object") return [parsed];
  return [];
}

/**
 * Parse a survey-pages raw response and return a map of
 * `page_number → ParsedFloorPlan[]`.
 */
export function parseSurveyFloorPlans(
  rawText: string | null | undefined,
): Map<number, ParsedFloorPlan[]> {
  const out = new Map<number, ParsedFloorPlan[]>();
  if (!rawText || typeof rawText !== "string") return out;
  if (rawText.startsWith("ERROR:")) return out;

  const parsed = parseChunkedSurvey(rawText) ?? tryParse(rawText);
  const pages = flattenPages(parsed);
  for (const p of pages) {
    const pageNum = Number(p?.page_number ?? p?.page ?? p?.pageNumber);
    if (!Number.isFinite(pageNum)) continue;
    const plans = Array.isArray(p?.floor_plans) ? p.floor_plans : [];
    const items: ParsedFloorPlan[] = [];
    for (let i = 0; i < plans.length; i++) {
      const fp = plans[i];
      if (!fp || typeof fp !== "object") continue;
      const plan_id =
        typeof fp.plan_id === "string" && fp.plan_id
          ? fp.plan_id
          : `fp_p${pageNum}_${i + 1}`;
      const refRaw = fp.reference_id;
      const reference_id =
        typeof refRaw === "string" && refRaw.trim().length > 0 ? refRaw.trim() : null;
      const floors = asStringArr(fp?.spatial_connection?.floors);
      const referenced_unit_ids = asStringArr(fp?.relationships?.referenced_unit_ids);
      items.push({
        plan_id,
        type: (fp.type as FloorPlanType) ?? "unknown",
        reference_id,
        xy_width_height_pct: asBbox(fp.xy_width_height_pct ?? fp.xy_width_height_pt),
        page_number: pageNum,
        floors,
        referenced_unit_ids,
      });
    }
    if (items.length > 0) out.set(pageNum, items);
  }
  return out;
}

/**
 * Friendly fallback label for a plan when reference_id is missing.
 * Prefers the joined floors list, then the raw plan_id.
 */
export function floorPlanDisplayLabel(plan: ParsedFloorPlan): string {
  if (plan.reference_id) return plan.reference_id;
  if (plan.floors.length > 0) return plan.floors.join(" / ");
  return plan.plan_id;
}

/**
 * Identifier used to cross-reference a unit floor plan from a level plan's
 * `referenced_unit_ids`. Prefers the human reference_id, falls back to plan_id.
 */
export function unitPlanRefKey(plan: ParsedFloorPlan): string {
  return plan.reference_id || plan.plan_id;
}

/**
 * Returns true if a normalized (0..1) point on a given page falls inside the
 * unit floor plan's bounding box. Used to attribute annotations to a unit
 * floor plan for per-level counts.
 */
export function isPointInsideUnitPlan(
  plan: ParsedFloorPlan,
  page: number,
  nx: number,
  ny: number,
): boolean {
  if (plan.type !== "unit_floor_plan") return false;
  if (plan.page_number !== page) return false;
  const bb = plan.xy_width_height_pct;
  if (!bb) return false;
  const [x, y, w, h] = bb;
  // bbox is in percentages (0..100) of the visible page.
  const x1 = x / 100;
  const y1 = y / 100;
  const x2 = (x + w) / 100;
  const y2 = (y + h) / 100;
  return nx >= x1 && nx <= x2 && ny >= y1 && ny <= y2;
}

/**
 * Find the unit floor plan that contains a given normalized point on a page.
 * Returns null when the point is not inside any unit plan.
 */
export function findContainingUnitPlan(
  unitPlans: ParsedFloorPlan[],
  page: number,
  nx: number,
  ny: number,
): ParsedFloorPlan | null {
  for (const u of unitPlans) {
    if (isPointInsideUnitPlan(u, page, nx, ny)) return u;
  }
  return null;
}

// ---- User-added (no-bbox) unit floor plans -------------------------------
// Stored in analysis_request_sheets.floor_plan_overrides under the reserved
// key "__added_unit_plans". Schema (backwards-compatible):
//   { plan_id, reference_id, page_number,
//     type?: "unit_floor_plan" | "level_floor_plan" | "schematic_level_row" | "typical_detail_block",
//     bbox_pct?: [x, y, w, h],
//     name?: string }

export interface AddedUnitPlanEntry {
  plan_id: string;
  reference_id: string;
  page_number: number;
  type?: FloorPlanType;
  bbox_pct?: [number, number, number, number] | null;
  name?: string | null;
}

export const ADDED_UNIT_PLANS_KEY = "__added_unit_plans";

export function getAddedUnitPlans(
  overrides: Record<string, any> | null | undefined,
  page?: number,
): AddedUnitPlanEntry[] {
  const raw = overrides?.[ADDED_UNIT_PLANS_KEY];
  if (!Array.isArray(raw)) return [];
  const items = raw.filter(
    (x) =>
      x &&
      typeof x.plan_id === "string" &&
      typeof x.reference_id === "string" &&
      typeof x.page_number === "number",
  ) as AddedUnitPlanEntry[];
  return typeof page === "number"
    ? items.filter((x) => x.page_number === page)
    : items;
}

export function addedUnitPlanToParsed(entry: AddedUnitPlanEntry): ParsedFloorPlan {
  return {
    plan_id: entry.plan_id,
    type: entry.type || "unit_floor_plan",
    reference_id: entry.reference_id,
    xy_width_height_pct: entry.bbox_pct ?? null,
    page_number: entry.page_number,
    floors: [],
    referenced_unit_ids: [],
  };
}

export function makeAddedUnitPlanId(refId: string, page: number): string {
  const slug = refId.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 40) || "unit";
  return `added_p${page}_${slug}_${Math.random().toString(36).slice(2, 6)}`;
}

// ---- Deleted plans -------------------------------------------------------
export const DELETED_PLAN_IDS_KEY = "__deleted_plan_ids";

export function getDeletedPlanIds(
  overrides: Record<string, any> | null | undefined,
): Set<string> {
  const raw = overrides?.[DELETED_PLAN_IDS_KEY];
  if (!Array.isArray(raw)) return new Set();
  return new Set(raw.filter((x) => typeof x === "string"));
}

// ---- Per-plan effective bbox / name --------------------------------------
export function getEffectiveBbox(
  fp: ParsedFloorPlan,
  overrides: Record<string, any> | null | undefined,
): [number, number, number, number] | null {
  const ovr = overrides?.[fp.plan_id];
  const o = ovr?.bbox_pct;
  if (Array.isArray(o) && o.length === 4 && o.every((n: any) => Number.isFinite(n))) {
    return [o[0], o[1], o[2], o[3]];
  }
  return fp.xy_width_height_pct;
}

export function getEffectiveLabel(
  fp: ParsedFloorPlan,
  overrides: Record<string, any> | null | undefined,
): string {
  const ovr = overrides?.[fp.plan_id];
  const name = typeof ovr?.name === "string" && ovr.name.trim() ? ovr.name.trim() : null;
  if (name) return name;
  return floorPlanDisplayLabel(fp);
}

export function getEffectiveType(
  fp: ParsedFloorPlan,
  overrides: Record<string, any> | null | undefined,
): FloorPlanType {
  const ovr = overrides?.[fp.plan_id];
  const t = ovr?.type;
  if (typeof t === "string" && t) return t;
  return fp.type;
}


