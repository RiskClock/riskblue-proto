## What's happening with the missing levels

Not a UI regression — `space_hierarchy_json` for this project is `status=failed` with the error:

> 503 — Gemini "model is currently experiencing high demand"

The Spatial Architect run never produced any `spatial_records`, so `canonicalLevelNames` is empty and the Threat Report sidebar correctly falls through to just "Unassigned". The new modal will surface this error visibly and let you re-run.

## Changes

### 1. New `SpatialArchitectModal`
- Toolbar "Spatial Architect" button no longer runs the agent — it opens this modal.
- Modal content:
  - **Status row**: idle / running / complete / failed (with error text + last run timestamp).
  - **"Build Spatial Model" button**: triggers the existing `spatial-architect` edge function. Confirms before overwriting an existing hierarchy.
  - **Levels list** (canonical, ordered by `space_index`). Each level row shows:
    - Editable name, index, reorder (↑/↓), delete.
    - Inline list of `(file · page)` chips assigned to it, with × to remove and an "Add pages…" picker that lists every drawing page in the request.
  - **"Add level"** button at the bottom.
  - **Save** writes the edited list back to `analysis_requests.space_hierarchy_json` (overwrite), preserving the original `parsed` shape so all downstream rollups keep working.

### 2. Threat Report cleanup
- Remove the per-level "Assign drawings…" button and the `AssignPagesToLevelModal` component.
- Stop reading `__manual_levels__` from `floor_plan_overrides` in the rollup (`surveyDerivedMaps`). Sources of truth become: survey-pages output + spatial-architect's `matched_sources`.
- Threat Report becomes read-only output again.

### 3. Persistence shape (overwrite `space_hierarchy_json.parsed`)
Keep the existing schema so nothing downstream breaks:
```
parsed.spatial_records[] = {
  standardized_space_name, space_category: "Contiguous Storey",
  space_index, applies_to_levels: [],
  matched_sources: [{ file_name, page_number }]
}
```
Unit/template records (`applies_to_levels` populated) are preserved untouched by the modal — the modal only edits Level records.

## Technical notes

- New file: `src/components/workbench/SpatialArchitectModal.tsx`.
- `WorkbenchProjectDetail.tsx`: replace `buildSpaceHierarchy` onClick with `setSpatialModalOpen(true)`; pass `onRun` (existing handler) + `analysisRequest` + `files`/`sheets` into the modal; remove `AssignPagesToLevelModal`, `assignLevelTarget` state, "Assign drawings…" button, and `__manual_levels__` branch in `surveyDerivedMaps`.
- Reuse existing files/sheets queries already loaded in the page; no new edge functions needed.
- Save path: `supabase.from("analysis_requests").update({ space_hierarchy_json: { ...existing, parsed: editedParsed } })`.
