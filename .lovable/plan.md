

# Fix: Respect Column Disable During In-Progress Triage

## Problem

The user unchecks a column **after** triage has already started. The queue was built at the start and items for that column are already queued. Toggling the checkbox only updates local state — it doesn't remove items from the in-flight queue.

## Fix

**File: `src/components/analysis/AnalysisSection.tsx`**

### 1. Add a `disabledColumnsRef` synced with state

```typescript
const disabledColumnsRef = useRef<Set<string>>(new Set());

useEffect(() => {
  disabledColumnsRef.current = disabledColumns;
}, [disabledColumns]);
```

### 2. Check the ref inside `startTriageScheduler` before dispatching each item

In the scheduler loop (line ~1862-1868 and ~1879-1885), after shifting an item from the queue, check if its column is now disabled. If so, skip it instead of calling `executeTriageItem`:

```typescript
const item = triageQueueRef.current.shift()!;
if (disabledColumnsRef.current.has(item.prompt.awp_class_name)) continue; // skip disabled
executeTriageItem(item);
```

This way, even though the queue was built before the user unchecked the column, each item is checked against the live disabled state right before execution.

### 3. Same check in `handleAnalyzeAll`

Use `disabledColumnsRef.current` instead of `disabledColumns` closure to ensure the latest state is read.

## Files Changed

| File | Change |
|---|---|
| `src/components/analysis/AnalysisSection.tsx` | Add `disabledColumnsRef`, check it before dispatching each queued triage/analyze item |

