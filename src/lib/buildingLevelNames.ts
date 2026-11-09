/**
 * Levels are shown by their short name ("Level 0") inside a building, but are
 * stored qualified with the building name ("Block B Level 0") so identical
 * level names in different buildings stay unique everywhere else.
 */
export function qualifyLevelName(name: string, buildingName: string | null | undefined): string {
  const n = name.trim();
  const b = (buildingName || "").trim();
  if (!b || !n) return n;
  if (n.toLowerCase().startsWith(b.toLowerCase() + " ")) return n;
  return `${b} ${n}`;
}

export function stripBuildingPrefix(name: string, buildingName: string | null | undefined): string {
  const n = name.trim();
  const b = (buildingName || "").trim();
  if (!b) return n;
  if (n.toLowerCase().startsWith(b.toLowerCase() + " ")) {
    const rest = n.slice(b.length).trim();
    return rest || n;
  }
  return n;
}
