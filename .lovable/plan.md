

# Fix: Stop Button Disappears After Starting Analysis

## Root Cause

When `handleAnalyzeAllV2` runs, it sets `hasTriggeredResumeRef = false` and `analyzeV2Running = true` synchronously, then does async work (DB updates, result deletion, queue building, scheduler start). React re-renders before the async work completes, and the auto-resume `useEffect` fires because all its guards pass:
- `analyzeV2Running` is true
- `hasTriggeredResumeRef` is false
- `analyzeV2TimerRef.current` is null (scheduler not started yet)
- `analyzeV2QueueRef.current` is empty (queue not built yet)

The auto-resume finds zero incomplete cells (results were just deleted) and immediately sets `analyzeV2Running = false`, killing the Stop button.

## Fix

In `handleAnalyzeAllV2`, set `hasTriggeredResumeRef.current = true` **instead of** `false` at line 2380. The auto-resume is meant for page revisits, not for fresh runs. The fresh run builds its own queue and starts its own scheduler — it should block the auto-resume effect entirely.

## File Changed

| File | Change |
|---|---|
| `src/components/analysis/AnalysisSection.tsx` | Change `hasTriggeredResumeRef.current = false` to `true` at line 2380 in `handleAnalyzeAllV2` |

