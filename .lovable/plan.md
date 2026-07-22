## Diagnosis

The backend data exists for both files:
- `A0.03-ASSEMBLIES-Rev.19.1.pdf` has a page 1 manual floor-plan bbox named `New Floor Plan 1`, with the effective type changed to `schematic_level_row`.
- `A0.04-ASSEMBLIES-Rev.4.1.pdf` has a page 1 manual floor-plan bbox named `New Floor Plan 1`, type `level_floor_plan`.

The modal shows the bboxes because it reads `floor_plan_overrides` directly.

The file-list badge is suppressed later by `pageSpaceValidNames` in `src/pages/WorkbenchProjectDetail.tsx`:
- Any sheet with manual additions is marked as “overridden”.
- The valid-name set is built from `floors[]` for `level_floor_plan` entries.
- Manually added plans currently have `floors: []`, while their display name is stored as `name` / `reference_id`.
- So the valid-name set becomes empty, and `mergedPageSpaceMap` filters out `New Floor Plan 1` even though `surveyDerivedMaps` produced it.

## Implementation plan

1. **Fix the validity filter**
   - Update `pageSpaceValidNames` so manually added `level_floor_plan` and `schematic_level_row` entries use the same effective label fallback as the survey-derived map:
     - prefer override `floors[]` when present
     - otherwise use override/name/reference label (`New Floor Plan 1`)
   - Include `schematic_level_row` alongside `level_floor_plan` in this filter.

2. **Use materialized floor-plan data consistently**
   - When building the valid-name set, materialize added/manual plans with their per-plan overrides before checking type/name.
   - This handles cases like A0.03 where the `__added_unit_plans` entry says `level_floor_plan` but the per-plan override changes it to `schematic_level_row`.

3. **Keep the scope narrow**
   - Do not change how bboxes are stored.
   - Do not alter Scout/spatial hierarchy behavior.
   - Only fix the file-list badge suppression path.

4. **Verify after implementation**
   - Confirm from source that `pageSpaceValidNames` now admits `New Floor Plan 1` for both added plan types.
   - Check the live workbench page for the two files and verify the badge appears on the single-page file rows.