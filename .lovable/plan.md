## Goal

Restore both spatial badge surfaces on the **55-75 Brownlow Phase One** analysis request (`13502949-c6ad-4e36-bf8e-1f28cf9c217c`) by synthesizing a Scout-shaped `survey_raw_response` for each file from the existing legacy `space_hierarchy_json.parsed.spatial_records`.

No schema changes, no UI changes. One-off data backfill via `supabase--insert`.

## Why this works

- **Sheet-level "Level …" badges** (`renderSpaceBadge`) read `space_hierarchy_json.parsed.spatial_records[*].matched_sources`. Brownlow's legacy data already matches this shape — these badges should render as soon as the page is loaded; if they don't, this backfill also rewrites the JSON in place which forces a fresh fetch.
- **Per-page floor-plan badges** (`floorPlansByFile` → `parseSurveyFloorPlans`) need each file's `survey_raw_response` to be a JSON string that the parser flattens into `floor_plans[]` per page. Brownlow has none, so we build one.

## What gets written

For each file under `analysis_request_id = 13502949…`, write `analysis_request_files.survey_raw_response` to a JSON string of the form the parser expects:

```json
{
  "file_name": "Combined Mech - Brownlow.pdf",
  "total_pages": <max page_number seen for this file>,
  "surveyed_pages": [
    {
      "page_number": 24,
      "floor_plans": [
        {
          "plan_id": "legacy_p24_1",
          "type": "level_floor_plan",
          "reference_id": "Ground Level",
          "xy_width_height_pct": [0, 0, 100, 100],
          "spatial_connection": { "floors": ["Ground Level"] },
          "relationships": { "referenced_unit_ids": [] }
        }
      ]
    }
  ]
}
```

Rules:
- One `floor_plans` entry per `(file_name, page_number)` row inside `spatial_records[*].matched_sources`.
- `reference_id` and `spatial_connection.floors[0]` = `standardized_space_name`.
- `xy_width_height_pct` = `[0, 0, 100, 100]` (full-page bbox, per chosen option).
- `type` = `"level_floor_plan"` (Brownlow has no unit templates in the legacy data; the loop will treat any `unit_templates` entry as `unit_floor_plan` if present, but inspection shows none).
- Also set `survey_raw_updated_at = now()` so the workbench rehydration effect picks it up.
- Leave `analysis_request_sheets.survey_result` alone (NULL is fine — `floorPlansByFile` keys off file-level raw, and the page-level survey_result hydration just no-ops).
- Leave `space_hierarchy_json` untouched (already correct).

## Technical steps

1. Single `supabase--insert` call that runs a PL/pgSQL `DO` block:
   - Reads `space_hierarchy_json->'parsed'->'spatial_records'` for the Brownlow request.
   - Groups `matched_sources` by `file_name`, then by `page_number`.
   - Builds the JSON envelope above with `jsonb_build_object` / `jsonb_agg`.
   - `UPDATE analysis_request_files SET survey_raw_response = <json>::text, survey_raw_updated_at = now() WHERE analysis_request_id = '13502949…' AND name = <file_name>`.
2. Verification query: `SELECT name, length(survey_raw_response) FROM analysis_request_files WHERE analysis_request_id = '13502949…'`.
3. Ask the user to refresh the Brownlow workbench page; confirm both the sheet-level "Level …" badges and the per-page floor-plan badges render.

## Out of scope

- No changes to `survey-pages`, `spatial-architect`, or `schema.ts`.
- No re-run of Scout — credits preserved.
- Other legacy projects untouched.
