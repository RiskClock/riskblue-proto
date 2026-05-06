## Diagnosis (from code + console log)

The console at the moment of the bug shows:
```
uiState: "complete", runId: be704859..., status: "complete",
pipelinePhase: null, progress: 0/0
```

This proves the visible state is being read from a row where `status='complete'` AND `analysis_run_id` is the prior run's id. Two root causes are responsible for the five bugs:

**Root cause A — backend can write `status='complete'` without advancing `analysis_run_id`.**
In `run-analysis-pipeline/index.ts`, several early-exit branches (`no files` L515, `no prompts` L534, `enabledAwpClasses empty` L550, summary edge cases L994/L1042/L1181) write `status='complete'` while leaving the run_id and phase as-is. So after Start, the request can flicker to "complete" while the new run is technically active.

**Root cause B — local-pending mask in `useAnalysisRequestState` releases too early.**
The mask drops as soon as `dbRunId !== priorRunId`. But the very first DB write of the new run sets `pipeline_phase='extracting'` AND can be immediately followed by an early-exit `status='complete'` write. There is also a window where realtime delivers an old "complete" row before the run-claim update arrives. Result: the badge briefly shows "Analysis Complete".

**Root cause C — extraction is concurrent (Phase 1 uses `runPool` with concurrency 5).** That breaks bug #2's expectation of top-to-bottom processing.

**Bugs 3/4/5 (no spinner / no green fill / no result):** the cell render code is correct, but it depends on `triageResults` and `results` queries being scoped to the correct, live `analysis_run_id`. When root cause A fires, the request row carries `status='complete'` and the frontend never enters the running branch, so the user perceives "no spinner / no fill / no result" — even though the data may eventually populate. Once the badge is fixed, these will surface naturally; we will additionally guarantee the queries refetch when run_id changes.

---

## Plan

### 1. Backend: never write `status='complete'` while a run is in flight

File: `supabase/functions/run-analysis-pipeline/index.ts`

- Replace every early-exit `status: 'complete'` write inside `runPipeline` (no files, no prompts, empty enabled set) with a clear failure-safe write:
  - If there is genuinely nothing to do, write `status: 'complete'`, `pipeline_phase: null`, AND `summary_data: { ...prev, no_eligible_drawings: true }`. This already maps to the `no_eligible_drawings` UI state.
  - Wrap each of these terminal writes with the existing `try_lock_analysis_finalize` advisory-lock pattern so a stale background invocation cannot finalize a superseded run.
- Add a hard guard before any `status: 'complete'` write: re-read `analysis_run_id` from the row and abort the write if it no longer matches `activeRunId`.

### 2. Backend: process Phase 1 extraction sequentially in file-list order

File: `supabase/functions/run-analysis-pipeline/index.ts`

- In Phase 1 (Extract), replace `runPool(files, MAX_CONCURRENCY=5, ...)` with a sequential loop that walks `files` in the same order they were fetched (which is the persisted file order). Keep stop-check between iterations.
- Phase 2 (Triage) and Phase 3 (Analyze) keep their current pool concurrency — they are not part of bug #2.

### 3. Frontend hook: harden the local-pending mask + add a "settling" guard

File: `src/hooks/useAnalysisRequestState.ts`

- Hold the local-pending mask until BOTH conditions are true:
  - `dbRunId !== priorRunId`, AND
  - `effectiveRow.pipeline_phase` is one of `extracting | triaging | analyzing | summarizing` OR `effectiveRow.status` is `processing`.
- If the new row arrives with `status='complete'` and `pipeline_phase=null` AND counts have not yet loaded for the new run_id → keep `uiState='syncing'` (already supported by the helper) instead of releasing to `complete`.
- Bump `beginLocalStart` to also track an explicit `clientRunId`; on auto-clear, only release after seeing a row whose run_id matches a "running" shape (above) or after the 30s safety timeout.

### 4. Frontend hook: invalidate run-scoped queries on run_id change

File: `src/hooks/useAnalysisRequestState.ts` (and `AnalysisSection.tsx` consumers)

- When `effectiveRow.analysis_run_id` changes, invalidate the exact query keys used by the grid:
  - `["triage-results", requestId, currentRunId]`
  - `["analysis-results", requestId, currentRunId]`
  - `["analysis-counts", requestId, currentRunId]`
- This guarantees triage spinners (bug 3), green-fill cells (bug 4), and analyze counts (bug 5) refetch the moment the run flips.

### 5. Frontend: cell renderers — explicit precedence per cell

File: `src/components/analysis/AnalysisSection.tsx` (`countForCell` + the per-cell JSX in the grid body)

Make per-cell precedence explicit, in this order, per `(file, class)` pair:
1. **Active run, triage row in `queued|pending|processing`** → spinner (bug 3 fix; ensure all three statuses are matched — `queued` is currently included).
2. **Active run, triage row complete with score** → green fill, opacity = `max(0.15, score/100)` (bug 4 — already implemented; ensure the `results?.find` lookup is also scoped to `currentRunId` so an absent result doesn't replace the green fill with an empty cell).
3. **Active run, analyze row in processing** → spinner (preserves bug 3 behavior in Phase 3).
4. **Active run, analyze row complete** → numeric count (bug 5 — verify `countForCell` is reading the run-scoped `results` array, not a stale one).
5. Fallback: empty cell.

Confirm `countForCell` only consults the run-scoped `results` array; no other source.

### 6. Phase-1 visual cue: highlight the currently-processing file row

File: `src/components/analysis/AnalysisSection.tsx`

- Drive `extractingFileIds` from `pipeline_jobs`/per-file extract status during Phase 1 (already partially wired). With sequential extraction, only one file id will be active at a time, naturally producing the top-to-bottom feedback.

### 7. Keep the debug panel for internal users only

File: `src/pages/AnalysisRequestDetail.tsx`

- Wrap `<AnalysisDebugPanel ... />` with the existing `isInternal` check so it remains visible only for `@riskclock.com` accounts. No removal.

### 8. Verification protocol (after implementation)

Before declaring done, capture and confirm via the (still-internal) debug panel for one WMSV run:

1. Immediately after Start: request row shows `status='processing'`, `pipeline_phase='extracting'`, new `analysis_run_id`. Badge: **Starting Analysis** → **Extracting Context**.
2. During Phase 1: only one file row spinner visible at a time, walking top-to-bottom.
3. During Phase 2: triage rows appear with `status='processing'` and matching new `analysis_run_id`; cells show spinners; on complete they fill green by score.
4. During Phase 3: analyzing cells spin then resolve to numeric counts.
5. No "Analysis Complete" badge appears at any point until counts of active jobs/triage = 0 AND row `status='complete'`.

---

## Technical notes

- The existing `useAnalysisRequestState.ts` already implements `syncing`, `no_eligible_drawings`, run-scoped count queries, and explicit precedence — so the hook changes are tightening the gates that already exist, not rewriting them.
- The `triage-drawings` and `analyze-drawings` edge functions already stamp `analysis_run_id` and reject superseded runs with 409. No schema changes needed.
- No DB migration required.

## Files to change

- `supabase/functions/run-analysis-pipeline/index.ts`
- `src/hooks/useAnalysisRequestState.ts`
- `src/components/analysis/AnalysisSection.tsx`
- `src/pages/AnalysisRequestDetail.tsx`
