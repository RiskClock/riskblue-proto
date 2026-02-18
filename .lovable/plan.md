
# Analysis Section — 3 Improvements

## Summary of Changes

All changes are in one file: `src/components/analysis/AnalysisSection.tsx`.

No backend changes, no edge function changes, no migration needed.

---

## 1. Stop / Abort Button

### Problem
Once analysis starts there is no way to cancel it. The file loop runs to completion even if the user navigates away or wants to stop.

### Implementation

Use a `useRef<boolean>` abort flag (`abortRef`) rather than `AbortController` because the fetch calls are already fire-and-forget per file — we just need to break the loop cleanly between files.

```typescript
const abortRef = useRef(false);
```

In `handleAnalyze`:
- Set `abortRef.current = false` at the start of the run.
- At the top of the per-file loop, check `if (abortRef.current) break;` — this stops the loop cleanly after the current in-flight fetch completes.
- A `handleStop` function sets `abortRef.current = true`.

The **Stop** button replaces the Analyze button in the header while `isAnalyzing === true`:

```
[ ⏹ Stop ]   ← shown while analyzing (replaces Analyze / Re-analyze)
[ ▶ Analyze ] ← shown when idle
```

The Stop button uses `variant="destructive"` so it is visually distinct. Clicking it sets the abort flag; the currently-in-flight file finishes, then the loop exits. The `finally` block runs normally (sets `analyzingClass` to null), leaving any completed-file results in place.

No toast is shown on stop — the progress panel disappearing is sufficient feedback. The Analyze / Re-analyze button returns to its normal state.

---

## 2. Remove Summarize Button

The manual Summarize button (currently shown when `hasResults && !isAnalyzing && !summary`) is removed. Auto-summarization already runs after `handleAnalyze` finishes. The button is not needed and adds noise.

When analysis is stopped mid-way, auto-summarize still fires for whatever files completed — this is the correct behavior (partial results are still summarized).

The `Sparkles` icon import stays because it is still used in the summary header row and the "No unique instances" message.

---

## 3. Persist Summary Across Page Revisits

### Problem
`summarizedInstances` is React state — it is in-memory only. When the user navigates away and comes back, the summary is gone even though `analysis_results` rows are already in the database.

### Root Cause
`handleSummarize` fetches from the `summarize-analysis` edge function and stores the result in local state only. On remount the state resets to `{}`.

### Fix: Auto-hydrate from DB results on mount

When `results` loads from the database, for each AWP class that has at least one `complete` result **and** no currently-in-progress analysis, automatically call `handleSummarize` if `summarizedInstances[className]` is not yet populated.

The pattern:

```typescript
useEffect(() => {
  if (!results || results.length === 0) return;
  if (analyzingClass) return; // don't re-hydrate mid-analysis

  // Group completed results by AWP class name
  const classesWithResults = [...new Set(
    results
      .filter(r => r.status === "complete")
      .map(r => r.awp_class_name)
  )];

  for (const className of classesWithResults) {
    if (!summarizedInstances[className] && !summarizing[className]) {
      handleSummarize(className);
    }
  }
}, [results, analyzingClass]);
// summarizedInstances and summarizing intentionally omitted from deps
// to avoid infinite loop — this only runs when results load
```

**Why this is safe:**
- The `summarize-analysis` edge function is idempotent — it reads from `analysis_results` and re-runs the AI summarization. Calling it multiple times gives the same output.
- The dep array excludes `summarizedInstances` and `summarizing` intentionally to avoid re-triggering after state updates.
- The `analyzingClass` guard prevents hydration from firing mid-run.
- Because `handleSummarize` is wrapped in `useCallback`, the ref is stable.

This means: on the first visit after analysis completes, the page auto-summarizes and stores the result in state. On re-entry, the same auto-hydrate fires again (fetches from DB, re-summarizes). The cost is one `summarize-analysis` call per AWP class per page load when results exist — acceptable for an internal tool.

---

## File Change Summary

| File | Changes |
|---|---|
| `src/components/analysis/AnalysisSection.tsx` | Add `abortRef`; `handleStop`; Stop button in header; auto-hydrate summary on mount from DB results; remove manual Summarize button |

No other files change.

---

## Technical Notes

- The abort flag is a `useRef` not `useState` to avoid re-renders — the loop checks it synchronously between iterations.
- The loop check is `if (abortRef.current) break` placed at the **top** of the loop body, before `setFileStatuses`. This means: the current in-flight fetch runs to completion, the file status is set, progress is incremented, then the next iteration is blocked. No files are left in a permanent `"processing"` state.
- The auto-hydrate `useEffect` runs on `results` change. Since `results` is a React Query query that loads once on mount (and re-fetches on invalidation), this fires once on page entry — not in a loop.
- `handleSummarize` is already `useCallback`-wrapped with `[requestId, toast]` deps, so it is safe to put in the effect without re-triggering it on every render.
