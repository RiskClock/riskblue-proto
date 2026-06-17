// Parse the raw text returned by the survey-pages agent into a structured
// list of floor-plan items keyed by source page number.

export type FloorPlanType =
  | "level_floor_plan"
  | "unit_floor_plan"
  | "master_plan"
  | string;

export interface ParsedFloorPlan {
  plan_id: string;
  type: FloorPlanType;
  reference_id: string | null;
  /** [left, top, width, height] as percentages (0..100) of the visible page. */
  xy_width_height_pct: [number, number, number, number] | null;
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
    // try to find an array
    const s = stripped.indexOf("[");
    const e = stripped.lastIndexOf("]");
    if (s >= 0 && e > s) {
      try { return JSON.parse(stripped.slice(s, e + 1)); } catch { /* */ }
    }
    return null;
  }
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

  const parsed = tryParse(rawText);
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
