

# Fix: Authoritative Rerun Clearing, Override Locking, Summarize Auth

## Root Cause: Results Not Clearing on Rerun

The race condition is in the pipeline edge function's execution order:

1. **Line 249-260**: Sets `status: "processing"` and returns 202 immediately (line 306)
2. **Line 286-296**: Kicks off `runPipeline()` in background via `waitUntil`
3. **Line 347-358** (inside `runPipeline`): Deletes old rows

The status update to `"processing"` triggers a realtime event on `analysis_requests`, which causes the frontend's realtime subscription to invalidate `triage-results` and `analysis-results` queries. These refetch from the DB **before** the background `runPipeline` has executed the DELETE statements. The 5-second polling interval on `analysis-results` (line 1364, unconditional) compounds this by continuously re-fetching stale rows.

**Fix**: Move the authoritative DELETE block from inside `runPipeline` (background, line 347-358) to the **main handler** (line 249-260 area), **before** setting `status: "processing"`. This ensures old rows are gone from the DB before any status change triggers realtime events or query refetches.

## Changes

### 1. `supabase/functions/run-analysis-pipeline/index.ts` — Move DELETE before status update

In the main handler (around line 249), insert the authoritative clear **before** the status update to `"processing"`:

```
// 1. Delete all previous results (before status change triggers realtime)
await Promise.all([
  admin.from("analysis_triage_results").delete().eq(...),
  admin.from("analysis_results").delete().eq(...),
  admin.from("analysis_triage_overrides").delete().eq(...),
  admin.from("analysis_request_files").update({ extracted_text: null, ... }).eq(...),
  admin.from("analysis_requests").update({ triage_tokens_used: 0, analyze_tokens_used: 0, summary_data: {} }).eq(...),
]);

// 2. THEN set status to "processing" (this triggers realtime → refetch → rows are already gone)
await admin.from("analysis_requests").update({ status: "processing", ... }).eq(...);
```

Remove the duplicate DELETE block from inside `runPipeline` (line 347-358) since it's now handled before the 202 response.

### 2. `src/components/analysis/AnalysisSection.tsx` — Lock overrides during deep analysis only

In `handleTriageCellClick`, add a guard that checks if the pipeline is in the `"analyzing"` phase specifically, not the whole pipeline:

```typescript
const handleTriageCellClick = async (...) => {
  // Lock overrides only during deep analysis phase
  if (pipelinePhase === "analyzing") return;
  // ... existing logic
};
```

Also remove `cursor-pointer` from triage cells when `pipelinePhase === "analyzing"`. Users can still include/exclude during extraction and triage phases.

Note: `pipelinePhase` is already derived from `requestMeta` at line 3428 but `handleTriageCellClick` is defined earlier (line 1418). The phase value will need to be read from `requestMeta` directly inside the handler, or the handler needs to be moved/wrapped to access the derived value.

### 3. `supabase/functions/summarize-analysis/index.ts` — Auth fix

Replace the `isInternal` gate (lines 44-49) with project-access auth: parse `analysisRequestId` from body first, then verify user is request owner, project owner, or project member via `analysis_requests` → `projects` join + `project_user_roles` check. Keep `isInternal` as fast-path bypass.

## Files changed

| File | Change |
|---|---|
| `supabase/functions/run-analysis-pipeline/index.ts` | Move DELETE to main handler before status update |
| `src/components/analysis/AnalysisSection.tsx` | Lock triage overrides only during `"analyzing"` phase |
| `supabase/functions/summarize-analysis/index.ts` | Replace internal-only gate with project-access auth |

