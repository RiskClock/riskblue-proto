## Goal

Surface the pipeline's existing per-page granularity (sheets) in the workbench drawings table, and trigger PDF splitting immediately after upload instead of lazily.

## 1. Auto-split immediately after upload

Currently splitting only runs as part of the full pipeline, with a fallback "auto-split" trigger when the user opens the project detail page. Change so it kicks off the moment uploads finish.

- In the manual upload flow on the project detail page, after all `analysis_request_files` rows reach `copy_status = 'copied'`, invoke `run-analysis-pipeline` with `phaseOverride: "split"` once.
- Same for cloud import flows (Drive / Procore / SharePoint) used in the workbench context: when the copy edge function finishes, enqueue a split-only pipeline run.
- Keep the existing "files exist but no sheets" defensive auto-trigger as a safety net.
- No backend logic changes — `phaseOverride: "split"` already exists and is non-destructive.

## 2. Table: parent row + expandable per-page rows

Replace today's flat file-row table with a two-level table.

- **Parent row** = one `analysis_request_files` row. Shows file name, file-level aggregated status, and existing AWP class instance counts (summed across that file's sheets).
- **Chevron** on parent row toggles a child block of per-page rows.
- **Child row** = one `analysis_request_sheets` row. Shows:
  - `{file.name} — p.{page_index}` (and `sheet_number` when present)
  - Three small status badges: **Extract**, **Triage**, **Analyze**
  - For each AWP class column: cell rendering per #3 below
- Single-page PDFs render as a parent row with no chevron (the one sheet IS the file).
- Clicking a child row opens the existing `FileViewerModal` scoped to that page (already supported — pages are individual storage objects).

### Status badge rules per sheet

| Phase | Source | States rendered |
|---|---|---|
| Extract | `analysis_request_sheets.extract_status` | pending / extracting / done / failed |
| Triage | aggregate of `analysis_triage_results.status` for this sheet across all active AWP classes | pending / partial / done / failed |
| Analyze | aggregate of `analysis_results` rows for this sheet | pending / running / done / failed |

Parent-row aggregated status = rollup of its sheets (e.g. "12/50 extracted").

## 3. AWP class column per sheet — preserve current visual

Match today's grid behavior:

- **Per-sheet AWP cell**: green background with opacity proportional to the triage `score` (0–100) for that `(sheet, awp_class)`. Same opacity ramp already used in the grid (e.g. `score/100`). On hover, tooltip shows the exact numeric score (e.g. "Triage: 73%").
- If no triage row yet for that sheet/class: empty cell (no fill).
- If `status = failed`: small red indicator + tooltip with error.
- Include/exclude overrides keep their current visual treatment.
- **Parent-row AWP cell**: unchanged — shows the existing instance count summed across the file's sheets.

## 4. Queries / data

- Extend the existing sheets query in `WorkbenchProjectDetail.tsx` to also pull `extract_status` (already pulled) + triage rows per sheet (score + status + override flags) for each active AWP class.
- Add a query for `analysis_results` grouped by `sheet_id` to derive per-sheet analyze status.
- All data is already keyed by `sheet_id` in the schema — no migration needed.

## 5. Out of scope

- No change to extract/triage/analyze backend logic (already per-sheet).
- No change to numeric triage score storage or thresholding.
- No UI change in WMSV detail page (workbench only).

## Technical notes

- Files to edit:
  - `src/pages/WorkbenchProjectDetail.tsx` — table rendering, expand state (per parent file), new queries, post-upload split trigger.
  - Possibly small helper in `src/lib/analysisUiState.ts` for the three new badge derivations.
- Reuse the existing opacity-by-score cell renderer from the analysis grid so workbench and grid stay visually consistent. Wrap each cell in a shadcn `Tooltip` showing `"Triage: {score}%"`.
- Expand state: local React state keyed by `file_id`, default collapsed. Optionally persist in `localStorage` per project (matches existing patterns).
- No edge function changes. No migration.
