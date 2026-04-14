

# Move Analysis Pipeline to Backend — All Workflows

## Problem
The entire analysis pipeline (Extract → Triage → Analyze) runs client-side in the browser for **both** WMSV and standard (internal) workflows. If the user navigates away or closes the tab, processing stops but the database status remains stale. The UI and DB status become disconnected — e.g., "Analysis in Progress" badge but "Start Analysis" button shown.

## Solution
Create a single backend edge function (`run-analysis-pipeline`) that orchestrates the full pipeline server-side. Both WMSV and standard workflows will use this function. The client becomes a thin progress viewer that polls the database.

## Database Changes

Add columns to `analysis_requests`:

| Column | Type | Default | Purpose |
|---|---|---|---|
| `pipeline_phase` | text | null | Current phase: `extracting`, `triaging`, `analyzing` |
| `pipeline_progress_done` | integer | 0 | Items completed in current phase |
| `pipeline_progress_total` | integer | 0 | Total items in current phase |
| `pipeline_stop_requested` | boolean | false | Client sets to signal graceful stop |

## New Edge Function: `run-analysis-pipeline`

Accepts: `{ analysisRequestId, visibleAwpClasses?, triageModel, analyzeModel, disabledColumns }`

1. Returns `202 Accepted` immediately
2. Uses `EdgeRuntime.waitUntil()` to run in background
3. Orchestrates three phases sequentially, calling existing edge functions (`triage-drawings` for extract + triage, `analyze-drawings` for analysis) via HTTP with service role key
4. Updates `pipeline_phase`, `pipeline_progress_done`, `pipeline_progress_total` in the DB after each item
5. Checks `pipeline_stop_requested` before each work item — stops gracefully if true
6. Sets `status = 'complete'` on finish; clears pipeline fields

Auth: validates the calling user is `@riskclock.com` or project owner before starting. Uses service role key for internal function calls.

## Client Changes: `AnalysisSection.tsx`

**For both WMSV and standard toolbars:**

1. **Start**: All "Start Analysis" / "Extract" / "Triage" / "Analyze" bulk actions call the `run-analysis-pipeline` edge function instead of running client-side orchestration. Individual per-class triage buttons also route through the backend.

2. **Progress display**: Poll `analysis_requests` every 3 seconds when `status === 'processing'`. Show phase label and progress bar from `pipeline_phase` / `pipeline_progress_done` / `pipeline_progress_total`.

3. **Stop**: Sets `pipeline_stop_requested = true` in the DB. The edge function checks this before each item.

4. **Hydration on page load**: If `status === 'processing'` and `pipeline_phase` is set, immediately show progress UI — no client-side resume needed.

5. **Table cell status**: Continue reading `analysis_results` and `analysis_triage_results` from DB (already works). Spinners derive from DB row `status = 'processing'` rather than local state.

6. **Remove client-side orchestration**: Delete `handleExtractAll`, `handleTriageAll`, `handleAnalyzeAllV2`, `handleWmsvStartAnalysis`, and all associated queue/inflight refs. Replace with simple edge function invocations.

## Files

| File | Change |
|---|---|
| Migration SQL | Add `pipeline_phase`, `pipeline_progress_done`, `pipeline_progress_total`, `pipeline_stop_requested` to `analysis_requests` |
| `supabase/functions/run-analysis-pipeline/index.ts` | **New** — backend orchestrator |
| `supabase/config.toml` | Add `[functions.run-analysis-pipeline]` with `verify_jwt = false` |
| `src/components/analysis/AnalysisSection.tsx` | Remove client-side orchestration; replace all start/stop handlers with edge function calls + DB polling for progress |

