## Root cause

The drawing modal shows the raw effective name of the level bbox (`L06`, `SEVENTH FLOOR` — from Scout's `reference_id` or the user-typed override `name`).

The file-list badge instead comes from `mergedPageSpaceMap`, which is built from `surveyDerivedMaps.levelMap`. That map does **not** store the bbox's raw name — it stores the result of `canonicalizeLevels(rawFloor)` (WorkbenchProjectDetail.tsx around lines 2243, 2261, 2268).

`canonicalizeLevels` walks the spatial-architect's canonical level list (`canonicalLevelNames`) and replaces the raw string with whichever architect entry matches after token normalization:

- `L06` → normalized token `"l 6"`; architect canonical `"SIXTH FLOOR"` normalizes to `"6"`; the `split(" ").includes(...)` clause at line 2156 matches → badge becomes `SIXTH FLOOR`.
- `SEVENTH FLOOR` → token `"7"`; architect canonical `"L07"` normalizes to `"l 7"`; same clause matches → badge becomes `L07`.

So whichever alias the spatial architect happened to pick wins for the badge, even when the bbox is user-placed and clearly named something else. That's why the modal and the badge disagree.

Canonicalization is still needed for annotation-to-space attribution (rolling annotations up to the architect's space list). It should not, however, override the label that gets shown to the user for a user-placed level bbox.

## Fix

In `surveyDerivedMaps` (WorkbenchProjectDetail.tsx ~2166–2306), track the display name alongside the canonical name for each level/schematic bbox:

1. For every `level_floor_plan` / `schematic_level_row` effective entry, compute `displayFloors`:
   - If `e.floors` came from Scout with real values, use those raw strings.
   - Otherwise fall back to `e.name` (the user-typed override / `reference_id`).
2. Add a new `pageLevelDisplayNames: Map<string, string[]>` populated with those `displayFloors` (deduped, in insertion order).
3. Keep the existing canonicalized `levelMap` / `unitMap` untouched so annotation attribution and the threat report continue to roll up to the architect's spaces.
4. In `mergedPageSpaceMap` (~2318), when a page has any survey-derived level entry, prefer the new `pageLevelDisplayNames` for that page instead of `levelMap`. Only fall back to the canonical/architect names for pages that have no user-placed bbox.
5. Leave `spacesForSheet` / `renderSpaceBadge` unchanged — they'll automatically read the display names via `mergedPageSpaceMap`.

## Result

- Modal shows `L06` → file-list badge shows `L06`.
- Modal shows `SEVENTH FLOOR` → badge shows `SEVENTH FLOOR`.
- Pages with no user bbox still fall back to the spatial-architect names, so scout-only files keep their current behavior.
- Annotation rollup / threat report attribution is unchanged because the canonical `levelMap` used for that path is untouched.

## Files

- `src/pages/WorkbenchProjectDetail.tsx` — extend `surveyDerivedMaps` return shape, plumb display names into `mergedPageSpaceMap`.
