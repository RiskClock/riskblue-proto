

# Fix: Triage Cell Colors Disappear on Stop

## Root Cause

When triage stops, `setTriageRunning(false)` fires the hydration `useEffect`. But `triageData` is stale — it was last fetched before triage started (the guard prevented refetches during triage). The stale data overwrites the local map, removing all newly scored results.

## Fix

**File: `src/components/analysis/AnalysisSection.tsx`**

In `handleStopTriage`, after in-flight requests drain, invalidate the triage query **before** setting `triageRunning` to false. This ensures fresh data is fetched, and when the hydration effect fires it uses up-to-date results.

```typescript
const pollId = setInterval(() => {
  if (inFlightCountRef.current <= 0) {
    clearInterval(pollId);
    // Invalidate FIRST so fresh data is fetched
    queryClient.invalidateQueries({ queryKey: ["triage-results", requestId] });
    setTriageRunning(false);
    setTriagePhase(null);
    setTriageStopping(false);
  }
}, 200);
```

## Files Changed

| File | Change |
|---|---|
| `src/components/analysis/AnalysisSection.tsx` | Add query invalidation before setting triageRunning to false in handleStopTriage |

