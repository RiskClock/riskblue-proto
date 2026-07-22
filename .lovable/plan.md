## Findings

- The expanded multi-page page rows do **not** use `renderSpaceBadge`; they render directly from `floorPlansByFile` and prefer `__overrideName`, then `floors[]`, then `floorPlanDisplayLabel`.
- The single-page file row does use `renderSpaceBadge(row.name, 1)`, which reads `spacesForSheet()` from `mergedPageSpaceMap`.
- For TMU A2.08, the actual data is:
  - Scout `floors[]`: `L07`
  - Scout `reference_id`: `SEVENTH FLOOR`
  - saved override `name`: `SEVENTH FLOOR`
- The previous fix still built the single-page badge display from `e.floors`, so it continued to choose `L07` instead of the same label path used by individual page rows.
- `renderSpaceBadge` is currently clickable and opens `SpaceEditModal`; this conflicts with the new requirement.

## Fix

1. Update the raw display-name calculation in `surveyDerivedMaps` for `level_floor_plan` / `schematic_level_row`:
   - Prefer the effective bbox label (`e.name`, which includes the saved override name and Scout `reference_id`).
   - Fall back to `e.floors` only if there is no effective label.
   - This makes single-page file-row badges use the same fundamental label source as the individual page rows.

2. Keep canonicalized `levelMap` unchanged:
   - Annotation attribution and threat-report rollups continue using canonical level names.
   - Only the visible badge label changes.

3. Make floor-plan space badges non-clickable everywhere `renderSpaceBadge` is used:
   - Remove the `onClick` handler that calls `openSpaceEdit`.
   - Remove clickable cursor/hover styling.
   - Keep the tooltip-only full-name display if the label is truncated.

4. Prevent `SpaceEditModal` from being opened by badges:
   - Leave the modal code intact for floor-plan editing paths that still need it.
   - Ensure file-list/title badges no longer open it.

## Files

- `src/pages/WorkbenchProjectDetail.tsx` only.