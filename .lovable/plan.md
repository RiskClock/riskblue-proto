## Problem

Three regressions on the WMSV analysis page:

1. No spinner next to file name while phase 1 (Extracting Context) runs.
2. "Processed" badge never appears after phase 1 finishes.
3. AWP classes the user did not select are still triaged by the backend.

## Root causes

**File: `src/components/analysis/AnalysisSection.tsx`**

- The per-file extract spinner depends on either `sheetProgressByFile` (only populated when `sheet_normalization_enabled=true`) or `extractingFileIds` (only populated by the manual per-class flow, never by the WMSV pipeline). Pipeline-driven runs in non-sheet mode therefore have no signal.
- The "Processed" badge reads `extractedFileIds`, which is loaded once on mount and refetched only on the `extracting → other` transition. In sheet-mode the parent file's `extracted_text` is never updated (only per-sheet rows are), so the parent-level query returns empty and no badge ever shows.
- `enabledAwpClasses` is computed from `disabledColumnsRef.current` at start time, but:
  - The ref is updated inside a `useEffect`, so it can lag a state change by one render → fast Start clicks can send a stale set.
  - When `disabled_awp_classes` is persisted as `[]` (a real array), the defaults-apply effect (DEFAULT_DISABLED_AWP) is skipped, so all classes look "enabled" to the start handler even though the user only ticked one.

## Plan

### 1. Reliable extract spinner

In the file-name cell render block (around line 3911 in `AnalysisSection.tsx`):

- Add a third spinner source: `pipelineExtracting = pipelinePhase === "extracting" || pipelinePhase === "splitting"`.
- Show the spinner when ANY of these are true: `sheetExtracting`, `legacyExtracting`, OR `pipelineExtracting && !extractedFileIds.has(file.id) && !sheetAllDone`.
- Tooltip falls back to the phase label when sheet-page counts are unavailable.

### 2. Reliable "Processed" badge

Refactor the source of truth for processed-state so it works in both sheet and non-sheet modes:

- Keep the existing sheet-mode `sheetAllDone` check.
- For non-sheet mode, refetch `extractedFileIds` on every transition of `pipelinePhase` (not only out of `extracting`) AND subscribe to realtime updates on `analysis_request_files` (filtered by `analysis_request_id=eq.<requestId>`) to keep it fresh while the run progresses.
- Add a fallback rule: once `pipelinePhase` is `triaging | analyzing | summarizing` or the run is `complete`, treat every `copiedFile` as processed for badge purposes (any file that reached triage must have completed extract).

### 3. Honor user's AWP selection at start

In `AnalysisSection.tsx`:

- In `startPipeline`, compute `enabledAwpClasses` from the live `disabledColumns` state (not the ref) so React's render-time snapshot is the source of truth. Keep the ref for places that genuinely need a non-rerendering value.
- Fix the defaults hydration effect (around line 1285): treat a persisted empty array `[]` the same as `null` — i.e. apply DEFAULT_DISABLED_AWP rather than clearing the selection. Only skip defaults when `disabled_awp_classes` is a non-empty array (meaning the user has previously made an explicit choice).
- After the user toggles a column, also wait for the persistence write to settle before allowing Start (small guard), or — simpler — write `disabled_awp_classes` synchronously in `toggleColumnDisabled` and read it back into `disabledColumns` only after success. (Pick the simpler option: rely on local state + explicit recompute in start handler; the persistence is informational.)

### 4. Verification

- Start a fresh WMSV analysis with only ERM selected and confirm:
  - Spinner appears next to the file name during phase 1.
  - "Processed" badge appears once phase 1 completes (before triage finishes).
  - Backend logs show only `ERM` in `enabledAwpClasses` and only ERM rows in `analysis_pipeline_jobs` for `job_kind='triage'`.
- Repeat in a project where `disabled_awp_classes` is persisted as `[]` to confirm defaults reapply.

No backend changes are required — the pipeline already filters strictly by `enabledAwpClasses` when supplied. All fixes live in `src/components/analysis/AnalysisSection.tsx`.
