/**
 * Groups Threat Report spaces (levels) by Spatial Architect buildings.
 * Levels in one building go under that building, levels linked to two or
 * more buildings go under "Shared Spaces", and everything else (including
 * "__unassigned__") goes under "Unassigned". Returns null when the project
 * has fewer than two buildings so callers keep the flat list.
 */
export interface SpaceGroup {
  key: string;
  label: string;
  spaces: string[];
}

export const SHARED_GROUP_KEY = "__shared__";
export const UNASSIGNED_GROUP_KEY = "__unassigned_group__";

export function groupSpacesByBuilding(spaces: string[], parsed: any): SpaceGroup[] | null {
  const buildings: Array<{ id: string; name: string }> = (Array.isArray(parsed?.buildings) ? parsed.buildings : [])
    .filter((b: any) => b && typeof b.id === "string")
    .map((b: any) => ({ id: b.id, name: typeof b.name === "string" && b.name.trim() ? b.name.trim() : "Building" }));
  if (buildings.length < 2) return null;
  const valid = new Set(buildings.map((b) => b.id));
  const records: any[] = parsed?.physical_spaces || parsed?.spatial_records || [];
  const idsByName = new Map<string, Set<string>>();
  for (const r of records) {
    const name = r?.standardized_space_name;
    if (typeof name !== "string" || !name) continue;
    const ids = (Array.isArray(r?.building_ids) ? r.building_ids : []).filter(
      (x: unknown): x is string => typeof x === "string" && valid.has(x),
    );
    const set = idsByName.get(name) ?? new Set<string>();
    ids.forEach((x: string) => set.add(x));
    idsByName.set(name, set);
  }
  const byBuilding = new Map<string, string[]>(buildings.map((b) => [b.id, []]));
  const shared: string[] = [];
  const unassigned: string[] = [];
  for (const s of spaces) {
    const ids = s === "__unassigned__" ? undefined : idsByName.get(s);
    if (!ids || ids.size === 0) unassigned.push(s);
    else if (ids.size === 1) byBuilding.get(Array.from(ids)[0])!.push(s);
    else shared.push(s);
  }
  const groups: SpaceGroup[] = buildings
    .map((b) => ({ key: b.id, label: b.name, spaces: byBuilding.get(b.id)! }))
    .filter((g) => g.spaces.length > 0);
  if (shared.length) groups.push({ key: SHARED_GROUP_KEY, label: "Shared Spaces", spaces: shared });
  if (unassigned.length) groups.push({ key: UNASSIGNED_GROUP_KEY, label: "Unassigned", spaces: unassigned });
  return groups;
}
