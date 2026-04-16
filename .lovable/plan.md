

## Plan: Fix stalled analysis + Add restart options menu

### Issue 1: Deep analysis silently skips items (no prompt content)

**Root cause**: The backend pipeline's Phase 3 (analyze) skips work items when `promptContent` is null (can't resolve from cache or Drive). The items count toward progress but produce no results. The "Kitchen & Washroom" and "Elevator Pit" classes are being skipped for ~15+ items, which explains why progress stalls at 21/30 and cells show no results after completion.

The prompt resolution in `run-analysis-pipeline/index.ts` (line 704-726) first checks `item.promptContent` (cached in DB), then falls back to calling `resolve-drive-doc` to fetch from Google Drive. If both fail, it silently returns. The progress counter still increments (via `runPool`), but no analysis result is written.

**Fix**: When prompt resolution fails, write a "failed" analysis result row so the UI shows the failure state instead of blank cells. Also log a more descriptive error.

**File**: `supabase/functions/run-analysis-pipeline/index.ts` (~line 720-726)
- Instead of just `return`, insert a failed result row into `analysis_results` with `status: 'failed'` and `error_message: 'No prompt content available'`
- Increment `analyzeFailures` counter

### Issue 2: Add 3-dot restart options menu (WMSV toolbar)

Add a `MoreVertical` (3-dot) dropdown menu on the right end of the WMSV toolbar with three restart options:

1. **Restart from Context Extraction** — clears everything (extracted text, triage, analysis results, summaries) and starts the full pipeline from scratch
2. **Restart from Triaging** — clears triage results, analysis results, and summaries, but keeps extracted text; calls `startPipeline("triage")`
3. **Restart from Deep Analysis** — clears only analysis results and summaries; calls `startPipeline("analyze")`

**File**: `src/components/analysis/AnalysisSection.tsx`
- Import `MoreVertical` from lucide-react
- Add the dropdown menu to the WMSV toolbar, positioned on the right side (opposite the Start Analysis button), only visible when not running
- Each option calls `startPipeline()` with the appropriate `phaseOverride` parameter — the backend already handles phase-specific clearing

### Technical details

**Backend fix** (pipeline edge function):
```typescript
// Replace silent return with explicit failure recording
if (!promptContent) {
  console.warn(`[pipeline] No prompt for ${item.awpClassName}, skipping`);
  analyzeFailures++;
  await admin.from("analysis_results").insert({
    analysis_request_id: analysisRequestId,
    file_id: item.fileId,
    awp_class_name: item.awpClassName,
    status: "failed",
    error_message: "No prompt content available for this class",
  });
  return;
}
```

**Frontend menu** (WMSV toolbar area, ~line 3507-3527):
Add a 3-dot dropdown between the engine selector and Start Analysis button grouping, aligned to the right using `ml-auto`. The three menu items map directly to existing `startPipeline()` calls with different phase overrides.

### Files to change
1. `supabase/functions/run-analysis-pipeline/index.ts` — Record failed results for missing prompts
2. `src/components/analysis/AnalysisSection.tsx` — Add 3-dot restart menu to WMSV toolbar

