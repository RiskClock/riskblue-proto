

# Realtime Subscriptions, Status-Precedence Guard, Optimistic Start/Stop

## What this fixes
1. **Start Analysis lag + flicker** — UI updates instantly before backend responds; stale polls cannot regress the state
2. **Triage cells not coloring** — Realtime subscription pushes triage results immediately; polling no longer depends on flickering `analyzeV2Running`
3. **Stop lag** — optimistic "Stopping..." UI appears immediately

## Migration

Enable realtime for `analysis_triage_results` (`analysis_requests` is already enabled):

```sql
ALTER TABLE public.analysis_triage_results REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.analysis_triage_results;
```

## `src/components/analysis/AnalysisSection.tsx`

**A) Status-precedence guard**

Add a rank map and ref to prevent stale data from regressing UI:

```
STATUS_RANK = { awaiting_upload:0, copied:1, started:2, processing:3, stopping:3, complete:4, failed:4 }
optimisticStatusRef = useRef<string|null>(null)
```

In the hydration effect (lines 1461-1499): if `optimisticStatusRef` is set and incoming status has a lower rank, skip the update. Clear optimistic ref when DB catches up or reaches terminal state.

**B) Optimistic start (before invoke, rollback on failure)**

In `startPipeline` (line 1887):
1. Save previous cache data
2. Set `optimisticStatusRef = "processing"`, `analyzeRunSyncRef = "starting"`, `setAnalyzeV2Running(true)`
3. Update query cache optimistically
4. Then call `supabase.functions.invoke`
5. On failure: rollback cache, clear refs, show toast
6. Remove `invalidateQueries` after optimistic set

**C) Optimistic stop (keeping active status)**

In `handleWmsvStop` (line 1930):
1. Set `optimisticStatusRef = "stopping"`, `setAnalyzeV2Stopping(true)`
2. Update query cache: keep `status: "processing"`, set `pipeline_stop_requested: true`
3. Toolbar shows "Stopping..." when `analyzeV2Stopping` is true, with disabled Stop button
4. Do NOT `invalidateQueries` — realtime handles the final state transition

**D) Realtime subscriptions**

Subscribe to:
- `analysis_requests` changes filtered by `id = requestId` → invalidate meta, triage, and analysis results
- `analysis_triage_results` changes filtered by `analysis_request_id = requestId` → invalidate triage results

Cleanup on unmount.

**E) Fallback polling**

`requestMeta` query: change `refetchInterval: 3000` → `ACTIVE_STATUSES.includes(dbStatus) ? 5000 : false`
`triageData` query: change `analyzeV2Running ? 5000 : false` → `ACTIVE_STATUSES.includes(dbStatus) ? 5000 : false`

Where `ACTIVE_STATUSES = ["pending","copying","copied","started","processing"]`

**F) Toolbar Stopping state**

WMSV toolbar condition changes from `wmsvRunning` to `wmsvRunning || analyzeV2Stopping`. When stopping, show "Stopping..." label, disable the Stop button.

## `src/components/WMSVProjectDetail.tsx`

1. Add Realtime subscription on `analysis_requests` filtered by `project_id`. On change, invalidate `wmsv-analysis-request` and `wmsv-analysis-files`.
2. Change polling from `isImporting ? 3000 : false` to `ACTIVE_STATUSES.includes(status) ? 5000 : false`.

## `src/pages/Projects.tsx`

For WMSV users, add Realtime subscription on `analysis_requests` (all rows). On UPDATE, update `analysisStatuses` map from payload. Cleanup on unmount.

## Files changed

| File | Change |
|---|---|
| Migration SQL | Enable realtime for `analysis_triage_results` |
| `src/components/analysis/AnalysisSection.tsx` | Status-precedence guard, realtime subs, optimistic start/stop, fallback polling, toolbar stopping state |
| `src/components/WMSVProjectDetail.tsx` | Realtime subscription + fallback-only polling |
| `src/pages/Projects.tsx` | Realtime subscription for WMSV status badges |

