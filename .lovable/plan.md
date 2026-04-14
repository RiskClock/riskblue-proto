

# Investigation Results & Fix Plan

## Issue 1: "69 instances" when only 1 AWP class appears checked

**Root cause:** The user has 2 controls enabled in their WMSV account (control IDs `a5acff5a` for "Presence of Water Sensor" and `91179e3f` for "Inline Flow Sensor"). The control `a5acff5a` is a `default_control_id` on almost every critical asset class (Electrical Room, Mechanical Room, Elevator Pit, Suite, Mass Timber, etc.).

The `visibleAwpClasses` list sent to the pipeline includes all AWP classes that match any enabled control — which is many more than just "Electrical Room." The pipeline then applies both the `disabledColumns` filter (10 disabled classes stored on the analysis request) and the `visibleAwpClasses` filter. After both filters, 3 classes remain: Electrical Room, Mass Timber and Millwork, and Suite. So the count is 23 files × 3 classes = 69.

**The real problem:** The `disabledColumns` checkbox state in the UI is independent of `visibleAwpClasses`. In WMSV mode, the disabled columns (checkboxes) were set during a previous run and are persisted on the analysis request. The UI shows all 3 remaining classes with checkboxes, but only ERM appears checked because MTM and STE were previously disabled by the internal user and then the disabled list was updated.

**Fix:** For WMSV mode, the `disabledColumns` concept should not apply — only `visibleAwpClasses` should determine which classes are processed. The pipeline should ignore `disabledColumns` when `visibleAwpClasses` is provided (since WMSV filtering is already the authoritative filter). Also hide the disable/enable checkboxes in WMSV mode since the user shouldn't toggle individual classes.

**Changes:**
- `run-analysis-pipeline/index.ts`: When `visibleAwpClasses` is provided, skip the `disabledColumns` filter entirely (visible classes are already the correct subset)
- `AnalysisSection.tsx`: In WMSV mode, hide the per-column checkboxes and don't send `disabledColumns`

## Issue 2: Status doesn't update automatically

**Root cause:** The polling is working (`refetchInterval: 3000` on `requestMeta`). However, the pipeline ran extremely fast because all triage calls hit rate limits and failed immediately. The pipeline went through all 69 items in seconds, logging errors for each, then marked as "complete." The user likely didn't see intermediate states because they happened too fast.

Additionally, the pipeline lacks retry logic for rate-limited API calls, so it silently fails through all items.

**Fix:** Add retry-with-backoff logic in the pipeline's `callFunction` helper for rate limit errors (HTTP 429 or `RateLimitError`). This will make the pipeline actually slow down and process items correctly, giving the user time to see progress updates.

**Changes:**
- `run-analysis-pipeline/index.ts`: Add retry logic (up to 3 retries with exponential backoff) in `callFunction` when the response is 429 or contains a rate limit error

## Issue 3: "Analysis Complete" but no results shown

**Root cause:** The database has 0 triage results and 0 analysis results for this request. Every single triage call failed with `RateLimitError` (visible in edge function logs). The pipeline caught each error, logged it, incremented progress, and moved on. After processing all items (all failures), it marked status as "complete."

Phase 3 (Analyze) found 0 eligible items (since all triage failed → no scores → nothing above the 50% threshold) and immediately completed.

**Fix:** The pipeline should track failure counts. If ALL items in a phase fail, the final status should reflect that (e.g., set `status: 'started'` with an error message rather than `'complete'`). Also, surface error information to the user.

**Changes:**
- `run-analysis-pipeline/index.ts`: Track success/failure counts per phase. If all items fail, set status to `started` with `error_message` instead of `complete`
- `AnalysisSection.tsx`: Display error message from `requestMeta` if present when status is not "processing"

## Summary of File Changes

| File | Change |
|---|---|
| `supabase/functions/run-analysis-pipeline/index.ts` | 1) Skip `disabledColumns` when `visibleAwpClasses` is provided. 2) Add retry-with-backoff for rate-limited calls. 3) Track failures and avoid marking "complete" when all items failed. |
| `src/components/analysis/AnalysisSection.tsx` | 1) Hide per-column checkboxes in WMSV mode. 2) Don't send `disabledColumns` in WMSV mode. 3) Show error message from DB when analysis failed. |

