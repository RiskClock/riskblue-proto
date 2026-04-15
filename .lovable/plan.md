

# Implementation: Pipeline Class Selection, Concurrency, UI Flicker & Project Status

This plan was previously approved. Proceeding with one user refinement: the Projects.tsx status-refetch effect depends on both `isWMSV` AND `projects` (stable project IDs), not only `isWMSV`.

## 1. `supabase/functions/run-analysis-pipeline/index.ts` — Full rewrite

- Replace `visibleAwpClasses` + `disabledColumns` with single `enabledAwpClasses: string[]`
- Add `createProgressTracker()` for monotonic DB writes (shared counter, `lastWritten` guard, coalescing)
- Add `runPool()` for max-5 concurrent workers with periodic stop checks (every 3 items per worker)
- Log received classes and final prompt/class list
- Batch token updates every 5 successes
- All three phases (extract, triage, analyze) use the pool

## 2. `src/components/analysis/AnalysisSection.tsx` — Three targeted edits

**A) Send `enabledAwpClasses`** (lines 1973-1981): Replace `visibleAwpClasses` + `disabledColumns` with:
```typescript
const enabledAwpClasses = sortedPrompts
  .filter(p => !disabledColumns.has(p.awp_class_name))
  .map(p => p.awp_class_name);
// body: { analysisRequestId, enabledAwpClasses, triageModel, analyzeModel, phaseOverride }
```

**B) Clear extractedFileIds on rerun** (before the invoke in `startPipeline`):
```typescript
setExtractedFileIds(new Set());
```

**C) Fix `wmsvRunning`** (line 3400):
```typescript
const wmsvRunning = analyzeV2Running || pipelineRunning || analyzeV2Stopping;
```

## 3. `src/pages/Projects.tsx` — Status hydration fix

Add effect depending on both `isWMSV` and project IDs:
```typescript
const projectIds = useMemo(() => projects.map(p => p.id), [projects]);

useEffect(() => {
  if (isWMSV && projectIds.length > 0) {
    fetchAnalysisStatuses(projectIds);
  }
}, [isWMSV, projectIds, fetchAnalysisStatuses]);
```

This ensures statuses are fetched when either `isWMSV` hydrates after projects load, or when projects load after `isWMSV` is already true.

## Files changed

| File | Change |
|---|---|
| `supabase/functions/run-analysis-pipeline/index.ts` | `enabledAwpClasses` only; concurrent worker pool (max 5); monotonic progress; logging |
| `src/components/analysis/AnalysisSection.tsx` | Send `enabledAwpClasses`; fix `wmsvRunning`; clear extractedFileIds on rerun |
| `src/pages/Projects.tsx` | Re-fetch statuses when both `isWMSV` and `projectIds` are available |

