

# Fix: Laggy Start + Missing Triage Progress/Results

## Issue 1: Start Analysis feels laggy (couple seconds delay)

**Root cause:** After calling `startPipeline()`, the UI waits for the next 3-second polling cycle (`refetchInterval: 3000` on `requestMeta`) to detect `status: "processing"`. There's no optimistic UI update.

**Fix:** In `startPipeline()`, immediately set optimistic local state so the toolbar switches to the "running" view before the backend even responds. Specifically, set a local `optimisticPipelineRunning` flag and use it alongside `pipelineRunning` to control the toolbar display. Clear it once `requestMeta` confirms processing.

Simpler approach: after the `supabase.functions.invoke` call succeeds, immediately call `queryClient.setQueryData` to optimistically update the `requestMeta` cache with `status: "processing"` and `pipeline_phase: "extracting"` (or the appropriate phase). This makes the toolbar switch instantly without waiting for the poll.

## Issue 2: Triage progress and results not showing

**Root cause (two problems):**

1. **Triage results query never re-fetches during pipeline:** The `triageData` query (line 1357) has `refetchOnWindowFocus: false` and **no `refetchInterval`**. When the backend pipeline creates triage results, the UI never polls for them. Only `requestMeta` polls every 3s.

2. **`RateLimitError` thrown as Deno exception, not caught:** The logs show `RateLimitError` is thrown by Deno's `fetch()` itself (not returned as HTTP 429). The `callFunction` helper's retry logic only checks `res.status === 429` after `fetch` returns, but `fetch` throws before returning. The `catch` at the call site (line 460-466) catches it but doesn't retry — it just increments `triageFailures` and moves on.

**Fixes:**

**a) Add polling for triage results during pipeline run:**
Add `refetchInterval` to the `triageData` query, gated on whether the pipeline is running. When `pipelinePhase === "triaging"`, poll every 5 seconds so results appear in real-time.

**b) Catch `RateLimitError` exception in `callFunction`:**
Wrap the `fetch()` call in a try/catch. If the caught error has `name === "RateLimitError"`, use its `retryAfterMs` property (or exponential backoff) and retry. This is the critical fix — without it, every triage call fails immediately.

**c) Also poll `analysis-results` during analyzing phase:**
The `results` query already has `refetchInterval: 5000` so this is fine, but verify it's adequate.

## Summary of Changes

| File | Change |
|---|---|
| `supabase/functions/run-analysis-pipeline/index.ts` | Wrap `fetch()` in try/catch to handle Deno `RateLimitError` exceptions with retry using `retryAfterMs` |
| `src/components/analysis/AnalysisSection.tsx` | 1) Optimistic UI update in `startPipeline` so toolbar switches immediately. 2) Add `refetchInterval` to `triageData` query when pipeline is running. |

