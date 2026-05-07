## Goal
Resolve three issues observed on Test6:
1. Badge shows "Analyzing Content 54/54 items" while the run is actually still in triage / dispatching analyze — phase + unit label are ambiguous.
2. Triage progress chip jumps from ~5/54 to 54/54 instantly because bulk short-circuit updates are counted as if pages were triaged.
3. Email + UI report "0 instances / No Eligible Drawings" even though pages scored 100 — Phase 3 dropped them because the triage model classified every page as `sheet_role = context_sheet`.

## Issue 1 — Phase label & unit clarity (frontend only)

`AnalysisSection.tsx` lines 3565–3576 and 3656–3666 currently render:
```
{pipelinePhaseLabel}   {done}/{total} {phase === "extracting" ? "pages" : "items"}
```

Changes:
- Replace the binary `pages | items` with a phase-specific unit:
  - `extracting` / `splitting` → `pages`
  - `triaging` → `drawings`
  - `analyzing` / `dispatching_analyze` → `classes`
  - `summarizing` → `classes`
- When `pipelinePhase === "dispatching_analyze"`, show the label `Preparing Analysis` (new entry in `presentAnalysisUiState`) instead of mapping it to `Analyzing Content`. This eliminates the moment where the chip says "Analyzing Content 54/54 items" while triage progress is still on screen.
- When the phase changes, reset the displayed `done/total` to render `—/—` for one tick instead of carrying the previous phase's numbers (avoids the "54/54" carry-over into the analyze phase). Implemented by gating the chip render on `pipelinePhase` matching the phase that set the counts; if the phase just transitioned and progress is still 54/54 from triage, render `…` until the next pipeline tick writes the analyze totals.

No backend or schema changes for Issue 1.

## Issue 2 — Distinguish short-circuited pages from triaged pages

`process-analysis-jobs/index.ts` `updateTriageProgress` counts every terminal triage job. After a bulk short-circuit, 49 jobs flip terminal in one update and the chip leaps from 5/54 to 54/54 — looking as if all pages were triaged.

Changes (frontend-only, no schema change):
- Show a clarifying suffix when short-circuit jobs exist: `54/54 drawings (5 triaged · 49 skipped via short-circuit)`. Source the `skipped` count from `analysis_pipeline_jobs` where `error_message LIKE 'Short-circuited%'` and `job_kind='triage'`, scoped to the current `analysis_run_id`. Cache via React Query keyed by `["triage-progress-breakdown", requestId, runId]`, polled at the same cadence as the existing pipeline-progress query, and invalidated on the `analysis_pipeline_jobs` realtime subscription that already exists.
- Tooltip on the chip: `"5 drawings triaged by AI; 49 auto-completed because a sibling page in the same file already scored 100% for this class."`

No backend changes — the data is already in `analysis_pipeline_jobs.error_message`.

## Issue 3 — Score-100 pages dropped because of sheet_role classification

`run-analysis-pipeline/index.ts` line 1458 hard-filters Phase 3 work queue:
```ts
if (t.sheet_role !== "analysis_sheet") continue;
```
Test6's triage returned all 5 rows as `context_sheet`, including two with `score = 100`. Result: empty workQueue → `no_eligible_drawings: true` → email "0 instances".

This is incorrect: a page scoring 100 against the AWP class is, by definition, an analysis sheet for that class regardless of how the model self-labeled `sheet_role`. Score + manual override should outrank the model's own role classification.

Changes:
- In the `useSheets` branch of the Phase 3 builder (lines 1457–1493), promote a row to `analysis_sheet` when EITHER:
  - the model returned `sheet_role === "analysis_sheet"`, OR
  - `override === "include"`, OR
  - `score >= 50` (the same eligibility threshold already used for non-sheet mode at line 1528)
- Concretely: replace the early `continue` on `sheet_role !== "analysis_sheet"` with a combined eligibility test that first computes `eligible` from override/score (mirroring the non-sheet branch), then accepts the row regardless of `sheet_role`. Keep the existing `override === "exclude"` short-circuit.
- This restores parity between sheet-mode and file-mode and stops silently dropping high-confidence pages.

Also tighten the triage prompt (`triage-drawings/index.ts` lines ~395–406) so that when the page contains real installed instances of the class, `sheet_role` MUST be `analysis_sheet` and not `context_sheet`. Add a one-line constraint: `If score >= 50 the page MUST be classified as analysis_sheet unless it is exclusively a legend/schedule/riser/keyplan/coversheet listing equipment that lives elsewhere.` This reduces the rate at which the model both scores 100 and labels `context_sheet`.

## Verification

1. Refresh Test6 mid-run: chip never reads "Analyzing Content 54/54 items"; instead shows `Triaging Drawings X/54 drawings`, then `Preparing Analysis …`, then `Analyzing Content X/N classes`.
2. After a short-circuit fires on page 2, chip shows `54/54 drawings (5 triaged · 49 skipped via short-circuit)` with tooltip.
3. Re-run a single-file PDF where the model returns `sheet_role=context_sheet` but `score=100`: Phase 3 dispatches an analyze job for that file/class; final email reports a non-zero instance count if the class is actually present.
4. Existing tests in `supabase/functions/analyze-drawings/run_id_test.ts` still pass; no schema migration required.

## Out of scope
- No DB migration.
- No change to short-circuit logic itself (it is working correctly).
- Triage model selection is unchanged; only the prompt language is tightened.
