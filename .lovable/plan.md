

# Fix: Authoritative Result Clearing, Upload Buttons, Drawing Preview, Aggressive Stop

## 1. Authoritative result clearing on rerun — `run-analysis-pipeline/index.ts`

**Problem**: Currently triage/analysis results are only deleted at the start of Phase 2 (line 479-500), not at the start of Phase 1. When "Start Analysis" is clicked, old triage cells and deep-analysis results persist in the DB and repopulate via realtime/queries even though the UI tried to clear local state.

**Fix**: Move the deletion of `analysis_triage_results`, `analysis_results`, `analysis_triage_overrides`, extracted text, and summary data to the **very beginning** of `runPipeline`, before Phase 1 starts. This ensures all three result layers are cleared at the source immediately when the pipeline begins:

```typescript
// At top of runPipeline, before Phase 1:
await Promise.all([
  admin.from("analysis_triage_results").delete().eq("analysis_request_id", analysisRequestId),
  admin.from("analysis_results").delete().eq("analysis_request_id", analysisRequestId),
  admin.from("analysis_triage_overrides").delete().eq("analysis_request_id", analysisRequestId),
  admin.from("analysis_request_files")
    .update({ extracted_text: null, openai_file_id: null, openai_file_status: null } as any)
    .eq("analysis_request_id", analysisRequestId),
  admin.from("analysis_requests")
    .update({ triage_tokens_used: 0, analyze_tokens_used: 0, summary_data: {} } as any)
    .eq("id", analysisRequestId),
]);
```

Remove the duplicate deletion block currently at the start of Phase 2 (lines 479-500). The Phase 3 per-class deletion (lines 677-685) can stay since it handles the case where Phase 3 runs independently.

On the frontend (`AnalysisSection.tsx`), keep `setExtractedFileIds(new Set())` in `startPipeline` for immediate visual feedback, and also clear the triage/analysis query caches so the UI doesn't flash stale data while waiting for the backend deletion to propagate:

```typescript
setExtractedFileIds(new Set());
setTriageResults(new Map());
setTriageOverrides(new Map());
queryClient.setQueryData(["analysis-results", requestId], []);
queryClient.setQueryData(["triage-results", requestId], []);
```

## 2. Upload buttons in grid sub-header — `AnalysisSection.tsx` + `WMSVProjectDetail.tsx`

**Props**: Add optional callbacks to `AnalysisSectionProps`:
- `onAddFileUpload?: () => void`
- `onAddFileDrive?: () => void`
- `onAddFileProcore?: () => void`

**Grid sub-header** (line 3694-3698): For WMSV, replace the Download ZIP button with:
```
Add more files: [Upload Files] [Google Drive] [Procore] [SharePoint (coming soon)]
```
For non-WMSV, keep Download ZIP.

**WMSVProjectDetail**: Pass the three callbacks to `<AnalysisSection>`. Remove the redundant inline upload button row (the "else" branch around lines 226-240 that shows upload buttons when files exist).

## 3. Drawing preview — RLS policy fix via migration

**Root cause confirmed**: The `drive-analysis-files` SELECT policy has a bug:
```sql
(projects.id)::text = (storage.foldername(projects.name))[1]
```
This compares the project UUID to `foldername(projects.name)` — the project's display name — instead of `name` (the storage object's path column). This means it never matches for non-internal users, causing a 403 on download.

The download code itself (`supabase.storage.from("drive-analysis-files").download(sourceFile.storage_path)`) is correct — this is purely an RLS bug.

**Fix** — migration:
```sql
DROP POLICY "Project members and internal users can view analysis files" ON storage.objects;

CREATE POLICY "Project members and internal users can view analysis files"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'drive-analysis-files'
  AND (
    EXISTS (
      SELECT 1 FROM projects
      WHERE (projects.id)::text = (storage.foldername(name))[1]
      AND (
        projects.user_id = auth.uid()
        OR is_project_member(auth.uid(), projects.id)
      )
    )
    OR is_internal_user(auth.uid())
  )
);
```

The key change: `storage.foldername(projects.name)` → `storage.foldername(name)` where `name` is the storage object's path.

## 4. Aggressive stop — `run-analysis-pipeline/index.ts`

**Current behavior**: Stop flag is checked every 3 items (`STOP_CHECK_INTERVAL = 3`), shared across 5 workers. A worker can dispatch 2 expensive calls before checking.

**Fix**: Check stop **before every item dispatch** instead of every N items:

```typescript
async function worker() {
  while (!stopped) {
    const i = nextIndex++;
    if (i >= items.length) return;

    // Check stop before every item
    if (await shouldStop(admin, requestId)) {
      stopped = true;
      return;
    }

    await processFn(items[i]);
    progress.increment();
    await progress.flush();
  }
}
```

Remove `itemsSinceStopCheck` and `STOP_CHECK_INTERVAL`. The worst-case delay becomes just the in-flight calls completing (up to 5 concurrent). The UI stays in "Stopping..." until the backend writes `status: "started"`, which is already handled by the fix from the previous round.

## 5. Extraction badge refresh — `AnalysisSection.tsx` (from previous round, unchanged)

Track `prevPipelinePhaseRef` and refresh `extractedFileIds` only when transitioning from `"extracting"` to another phase:

```typescript
const prevPipelinePhaseRef = useRef<string | null>(null);
useEffect(() => {
  const prev = prevPipelinePhaseRef.current;
  prevPipelinePhaseRef.current = pipelinePhase;
  if (prev === "extracting" && pipelinePhase !== "extracting" && requestId) {
    supabase.from("analysis_request_files").select("id")
      .eq("analysis_request_id", requestId)
      .not("extracted_text", "is", null)
      .then(({ data }) => {
        if (data) setExtractedFileIds(new Set(data.map((f: any) => f.id)));
      });
  }
}, [pipelinePhase, requestId]);
```

## Files changed

| File | Change |
|---|---|
| `supabase/functions/run-analysis-pipeline/index.ts` | Move result deletion to pipeline start; check stop before every item |
| `src/components/analysis/AnalysisSection.tsx` | Clear caches on rerun; add upload button props/UI; phase-transition badge refresh |
| `src/components/WMSVProjectDetail.tsx` | Pass upload callbacks; remove redundant upload row |
| Migration SQL | Fix `drive-analysis-files` SELECT RLS policy |

