// Shared helpers for expanding AWP subtype abbreviations (stored in the
// annotation "Type" / pipe_type metadata field) into human-readable labels,
// and for deciding which classes get split per (Type, Pipe size) in the
// Threat Report.

import { SUBTYPED_CLASSES } from "@/components/CreateProjectModal";

/** class name -> { ABBR -> full label } */
export const SUBTYPE_LABEL_BY_ABBR: Record<string, Record<string, string>> =
  Object.fromEntries(
    Object.entries(SUBTYPED_CLASSES).map(([className, defs]) => [
      className.toLowerCase(),
      Object.fromEntries(defs.map((d) => [d.abbr.toUpperCase(), d.label])),
    ]),
  );

/**
 * Expands a stored Type value (usually a subtype abbreviation like "MMCH")
 * into its full label ("Main Mechanical"). Unknown values pass through
 * unchanged so free-typed values still render as entered.
 */
export function expandSubtypeLabel(className: string, typeValue: string): string {
  const raw = (typeValue || "").trim();
  if (!raw) return raw;
  const map = SUBTYPE_LABEL_BY_ABBR[(className || "").toLowerCase()];
  if (map) {
    const hit = map[raw.toUpperCase()];
    if (hit) return hit;
  }
  // Fall back to any class' mapping (aliased class names, legacy rows).
  for (const m of Object.values(SUBTYPE_LABEL_BY_ABBR)) {
    const hit = m[raw.toUpperCase()];
    if (hit) return hit;
  }
  return raw;
}

/**
 * Returns the canonical subtype abbreviation ("DCHW") for a stored Type value,
 * which may already be the abbreviation or the full label. Returns null when
 * the value isn't a known subtype.
 */
export function subtypeAbbr(className: string, typeValue: string): string | null {
  const raw = (typeValue || "").trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  const maps = [
    SUBTYPE_LABEL_BY_ABBR[(className || "").toLowerCase()],
    ...Object.values(SUBTYPE_LABEL_BY_ABBR),
  ].filter(Boolean) as Record<string, string>[];
  for (const m of maps) {
    if (m[upper]) return upper;
    for (const [abbr, label] of Object.entries(m)) {
      if (label.toUpperCase() === upper) return abbr;
    }
  }
  return null;
}

/**
 * Classes whose Threat Report rows/columns split per (Type, Pipe size):
 * Cold Water, Hot Water and the unified Riser class.
 */
export function isSubtypeSplitClass(name: string): boolean {
  const n = name || "";
  return /(^|\s)(cold|hot)\s*water(\s|$)/i.test(n) || /(^|\s)riser(s)?(\s|$)/i.test(n);
}
