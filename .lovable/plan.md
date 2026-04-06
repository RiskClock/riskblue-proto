

# Fix: Spinners Disappearing During Triage

## Root Cause

The `useEffect` on line 1306 watches `triageData` (from React Query) and **replaces the entire local `triageResults` map** with whatever is in the DB. During triage:

1. `handleTriageAll` calls `invalidateQueries(["triage-results"])` at line 1958 (after clearing old results)
2. React Query refetches from DB
3. The `useEffect` fires and overwrites the local map — wiping out any "processing" spinner states that were set locally but not yet written to DB
4. Window refocus can also trigger refetches with the same effect

Additionally, React Query may refetch on window focus by default, causing the same issue mid-triage.

## Fix

**File: `src/components/analysis/AnalysisSection.tsx`**

1. **Guard the hydration `useEffect`**: Only hydrate from DB when triage is NOT running. When `triageRunning` is true, skip the `setTriageResults` call so local processing states are preserved.

```typescript
useEffect(() => {
  if (!triageData || triageRunning) return;  // <-- add triageRunning guard
  const map = new Map<string, TriageResult>();
  for (const r of triageData) {
    map.set(`${r.file_id}_${r.awp_class_name}`, r);
  }
  setTriageResults(map);
}, [triageData, triageRunning]);
```

2. **Disable React Query refetching during triage**: Add `refetchOnWindowFocus: false` to the triage-results query to prevent unexpected overwrites on tab switching.

```typescript
const { data: triageData } = useQuery({
  queryKey: ["triage-results", requestId],
  refetchOnWindowFocus: false,
  ...
});
```

## Files Changed

| File | Change |
|---|---|
| `src/components/analysis/AnalysisSection.tsx` | Guard hydration effect with `triageRunning`; disable window-focus refetch on triage query |

