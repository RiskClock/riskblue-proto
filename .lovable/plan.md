## Diagnosis

The previous migration walked `space_hierarchy_json.parsed.spatial_records` and wrote **one `floor_plan` entry per (physical level, page)** into `analysis_request_files.survey_raw_response`. So a page that depicts a typical plan spanning Levels 13 - 57 ended up with ~45 separate single-floor `floor_plan` records, each with its own bbox, producing one badge per physical level.

The downstream Threat Compiler reads `floors[]` from each `floor_plan`, so the correct shape is **one `floor_plan` per page**, with `floors[]` listing every physical level that page represents, and a single shared bbox `[0, 0, 100, 100]`.

Yes — we need to re-migrate. Source data (`spatial_records[].matched_sources`) is intact and sufficient; no user-supplied mapping needed.

## Step 1 — Re-migrate `survey_raw_response` (Brownlow only)

Scope: `analysis_request_id = 13502949-c6ad-4e36-bf8e-1f28cf9c217c`, file `Combined Mech - Brownlow.pdf`.

Algorithm (one-off Node/TS script run via shell, against Supabase REST with service role):

1. Read `space_hierarchy_json.parsed.spatial_records` and `unit_templates`.
2. Build `pageToLevels: Map<pageNumber, string[]>` by iterating every record's `matched_sources` and appending `standardized_space_name` to the page's bucket. Preserve insertion order; dedupe.
3. For each page bucket, emit **exactly one** `floor_plan`:
   ```json
   {
     "type": "level_floor_plan",
     "plan_id": "legacy_p{page}_1",
     "reference_id": "<formatted label of the level set>",
     "relationships": { "referenced_unit_ids": [] },
     "spatial_connection": {
       "type": "single_floor",  // or "multi_floor" when floors.length > 1
       "floors": [ ...levelNames ]
     },
     "xy_width_height_pct": [0, 0, 100, 100]
   }
   ```
4. `unit_templates` → emit one `unit_floor_plan` per `matched_sources` page, with `floors = applies_to_levels`, `reference_id = unit_name`, bbox `[0, 0, 100, 100]`. (None exist in current data — no-op safe.)
5. Wrap as `{ file_name, total_pages: 47, surveyed_pages: [...] }`, JSON-stringify, write back to `analysis_request_files.survey_raw_response`. `total_pages` preserved from existing payload.

Pages not referenced by any `spatial_records` entry are omitted (matches Scout convention).

Idempotent: re-running with the same input produces the same output.

## Step 2 — Badge label formatter

In `src/pages/WorkbenchProjectDetail.tsx`, update `groupSpaceLabels` (and any path that produces a level-set chip from a `floors[]` array on a single plan):

- Detect numeric Level entries (`/^Level\s+(\d+)/i` or `/^L(\d+)/i`); sort, then split into contiguous runs and stragglers.
- Render exactly **one chip per plan** (not one per chunk) — concatenate as:
  - Single level → `"Level 13"` (unchanged singular)
  - Pure range → `"Levels 13 - 57"` (plural, spaces around `-`)
  - Mixed runs/singles → `"Levels 4, 5, 12 - 17"` (plural, comma-separated, spaces around `-` inside ranges)
  - Non-numeric names (e.g. "Ground Level", "Mezzanine Level") → joined with `, ` and prefixed `"Levels "` only when more than one
- Per-plan rendering site (`levelPlans.map(...)`) reverts to **one `<Badge>` per plan** (no more per-chunk badges), using the new formatter against `plan.floors`.

Non-interactive chip; existing color (`awpClassColor("Level Floor Plan")`) preserved. No change to triage-cell green-removal already shipped.

## Step 3 — Verification

- `psql` check: confirm each page in `survey_raw_response` has `floor_plans.length === 1` (except pages with both a level plan and a unit plan, which keep both as separate entries).
- Reload `/internal/workbench/project/86ab9e72-…`: each page row shows exactly one Levels badge with the correct combined label.

## Out of scope

- `space_hierarchy_json` itself — leave intact; it's the source of truth we migrated *from*.
- Other projects — Brownlow only.
- Threat Compiler agent — it already consumes `floors[]`, so once each plan carries the full list, badges and compiler agree.

## Technical notes

- Script lives under `/tmp/` (one-off, not committed).
- Uses `SUPABASE_SERVICE_ROLE_KEY` via REST (psql is read/insert-only and this is an UPDATE of a JSON column on an existing row — handled via PostgREST PATCH).
- `groupSpaceLabels` returns `string` (single label) instead of `string[]`; callers updated accordingly.
