

# Fix: Triage Results Flash When Last Item Finishes

## Problem

When the triage scheduler completes, the callback runs `setTriageRunning(false)` **before** `queryClient.invalidateQueries(...)`. This unblocks the hydration effect (line 1336: `if (!triageData || triageRunning) return`), which immediately fires with stale cached data — producing an empty or outdated map. Then the invalidation triggers a refetch, and fresh data hydrates again. The result is a visible flash where all cells go white then repopulate.

The stop handler already has the correct order (invalidate first, then set running false). The scheduler completion callbacks do not.

## Fix

**File: `src/components/analysis/AnalysisSection.tsx`**

In every `startTriageScheduler` completion callback (there are two — one in `handleTriageClass` around line 2086 and one in `handleTriageAll` around line 2142), swap the order so `invalidateQueries` runs first:

```typescript
startTriageScheduler(() => {
  queryClient.invalidateQueries({ queryKey: ["triage-results", requestId] });
  setTriageRunning(false);
  setTriagePhase(null);
});
```

This matches the pattern already used in `handleStopTriage` (line 2161-2163) and ensures fresh data is queued for fetch before the hydration guard is lowered.

## Files Changed

| File | Change |
|---|---|
| `src/components/analysis/AnalysisSection.tsx` | Swap order in 2 scheduler completion callbacks: invalidate before setting triageRunning to false |

