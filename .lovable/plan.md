

# Fix: analyze-drawings Auth, Stopping State, Extraction Badges

## 1. `supabase/functions/analyze-drawings/index.ts` — Auth fix

Replace the internal-only gate (lines 265-270) with the same project-access check used in `triage-drawings`:
- Move `req.json()` before the auth check
- After getting user, resolve fileId → `analysis_request_files` → `analysis_requests!inner(project_id, user_id)` → allow if request owner, project owner, or `project_user_roles` member
- Keep `isInternal` as a fast-path (skip the join)

## 2. `src/components/analysis/AnalysisSection.tsx` — Fix "Stopping..." never resolving

In both the hydration block (line 1499) and the post-hydration block (line 1518), add `"started"` as a state that clears stopping/running flags:
```typescript
if (isTerminal || dbStatus === "started") {
  analyzeRunSyncRef.current = "idle";
  setAnalyzeV2Running(false);
  setAnalyzeV2Stopping(false);
  setAnalyzingClasses(new Set());
  setClassFileStatuses({});
}
```

Also clear `optimisticStatusRef` when `"started"` is received.

## 3. `src/components/analysis/AnalysisSection.tsx` — Extraction badge refresh on phase transition

Track the previous pipeline phase with a ref, and only refresh when it transitions **from** `"extracting"` to something else:

```typescript
const prevPipelinePhaseRef = useRef<string | null>(null);

useEffect(() => {
  const prev = prevPipelinePhaseRef.current;
  prevPipelinePhaseRef.current = pipelinePhase;

  // Only fire when transitioning OUT of "extracting"
  if (prev === "extracting" && pipelinePhase !== "extracting" && requestId) {
    supabase
      .from("analysis_request_files")
      .select("id")
      .eq("analysis_request_id", requestId)
      .not("extracted_text", "is", null)
      .then(({ data }) => {
        if (data) setExtractedFileIds(new Set(data.map((f: any) => f.id)));
      });
  }
}, [pipelinePhase, requestId]);
```

This avoids firing on initial load or unrelated updates — it only triggers when `pipelinePhase` was `"extracting"` in the previous render and has now changed.

## Files changed

| File | Change |
|---|---|
| `supabase/functions/analyze-drawings/index.ts` | Replace internal-only gate with project-access auth check |
| `src/components/analysis/AnalysisSection.tsx` | Clear stopping state on `"started"`; refresh badges only on extracting→other transition |

