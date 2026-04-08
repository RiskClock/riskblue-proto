

# Fix Repeated "Analysis Complete" Toast, Ordering, and Concurrency Issues

## Problems Identified

### 1. Repeated "Analysis Complete" toast
The scheduler's `setInterval` (line 1934/2641) checks completion every 1 second. When `queue.length === 0 && inFlight <= 0`, it fires the completion logic — but the completion callback is async (`await queryClient.invalidateQueries...`), so the interval fires again before `clearInterval` executes. The completion block runs multiple times.

Additionally, after completion sets status to `"complete"` and `analyzeV2Running` to false, the hydration `useEffect` (line 1631) detects the DB status change and re-triggers, and the auto-resume `useEffect` (line 1722) has `results` in its dependency array — every query invalidation changes `results`, potentially re-triggering resume logic.

### 2. Non-sequential processing (cells further down start early)
The scheduler fires `executeItem` for up to 5 items immediately. With horizontal-first ordering, items are queued as: `[file1-classA, file1-classB, file2-classA, file2-classB, ...]`. The scheduler dequeues 5 at once — so if file1 has 2 classes and file2 has 2 classes, items from file3 start before file1 finishes. This is correct concurrency behavior, but the user expects strict row-by-row sequential execution (all of file1's classes complete before file2 starts).

### 3. More than 5 concurrent analyses
The `setInterval` runs every 1000ms and checks `analyzeV2InFlightRef.current < MAX_CONCURRENT_ANALYZE`. But the immediate-fire block at line 1953/2667 ALSO dequeues items. Both the immediate block and the first interval tick can run before any `executeItem` has incremented `inFlight` (since `executeItem` is async and increments on the first line of its body). This race condition allows more than 5 items to be dispatched.

## Fixes

### File: `src/components/analysis/AnalysisSection.tsx`

**Fix 1 — Prevent repeated completion toast:**
- Add a `completionFiredRef = useRef(false)` flag. Set it to `false` when starting analysis, check it in the scheduler's completion block. Only fire toast/status-update if `!completionFiredRef.current`, then set it `true`.
- In the `setInterval` completion check, call `clearInterval` synchronously BEFORE the async block, and guard with the flag.

**Fix 2 — Enforce sequential (row-by-row) execution:**
- Instead of dequeuing up to `MAX_CONCURRENT_ANALYZE` items freely from the flat queue, group work items by file. Only dequeue items from the current file group. Once all items for that file complete, move to the next file group.
- Concurrency of 5 still applies within a single file's classes and across files (e.g., if file1 has 2 classes, 3 slots remain for file2's first 3 classes). But items for file N+1 should only start once file N's upload is resolved (not before).

**Fix 3 — Fix concurrency race:**
- Increment `analyzeV2InFlightRef.current` synchronously when dequeuing (in the scheduler loop), not inside the async `executeItem`. Decrement in the `finally` block as before. This prevents the interval and immediate-fire from over-dispatching.

**Fix 4 — Prevent auto-resume re-triggering after normal completion:**
- Reset `hasTriggeredResumeRef.current = false` only when starting a fresh run, not on every mount.
- Remove `results` from the auto-resume `useEffect` dependency array (use a ref or one-time check instead) to prevent re-triggering when query data updates.

## Summary of changes

| Issue | Root Cause | Fix |
|---|---|---|
| Repeated toast | Async completion in setInterval races with next tick | Sync clearInterval + completion guard ref |
| Non-sequential rows | Flat queue dequeues across file boundaries | Group-aware dequeuing |
| >5 concurrent | inFlight incremented async after dequeue | Increment inFlight synchronously at dequeue time |
| Auto-resume re-fire | `results` in useEffect deps triggers re-run | Remove `results` dep, use ref-based check |

