

# Fix Analysis V2: 6 Issues

## 1. White text on green background cells
Instance count text in analyzed cells uses `text-primary` (blue) which is hard to read on dark green. Change to white.

**File**: `AnalysisSection.tsx` — line ~3033, change `text-primary` to `text-white` for the instance count button in cells with triage background.

## 2. Increase instance count font size
Bump `text-xs` to `text-sm` on the instance count buttons (lines ~3033 and ~3060).

## 3. Change "cells" to "instances" in progress text
**File**: `AnalysisSection.tsx` — line ~2815, change `cells` to `instances` in the `Analyzing: x/y cells` text. Also line ~2744 for triage.

## 4. Track and display analyze token usage
- **DB migration**: Add `analyze_tokens_used` integer column to `analysis_requests` (default 0).
- **Edge function** (`analyze-drawings`): Extract `responsesResult.usage` from the OpenAI response and include `usage` in the returned JSON.
- **Client** (`AnalysisSection.tsx`):
  - Add `analyzeTokens` state, hydrate from DB on mount.
  - Reset to 0 when V2 starts.
  - Accumulate tokens from each successful `executeAnalyzeV2Item` response.
  - Persist to DB after each accumulation.
  - Show live count while running, info icon with tooltip when complete (same pattern as triage tokens).

## 5. Visual indicator for file upload during analysis
When a file is being uploaded to OpenAI (the first class call without `openaiFileId`), show a visual indicator on that file's row.
- Add `uploadingFileIds` state (`Set<string>`).
- Set it before the upload call in `handleAnalyzeAllV2` (line ~1998), clear after response.
- In the file name column (line ~2974 area), show a small upload icon/spinner when `uploadingFileIds.has(file.id)`.

## 6. Fix analysis summary not populating
**Root cause**: `summarize-analysis` edge function uses `supabase.auth.getClaims()` which doesn't exist in the Supabase JS client. It should use `supabase.auth.getUser()` instead (same pattern as `analyze-drawings`).

**Also**: The summarize calls fire from inside the `setInterval` completion callback. The results may not be available yet because `invalidateQueries` is async. Add `await` before the invalidation, then call summarize.

**File**: `supabase/functions/summarize-analysis/index.ts` — Replace `getClaims` with `getUser` for auth check.
**File**: `AnalysisSection.tsx` — In the V2 scheduler completion (line ~2096), await the invalidation, then trigger summarize calls.

## Files Changed

| File | Change |
|---|---|
| Migration SQL | Add `analyze_tokens_used` column to `analysis_requests` |
| `supabase/functions/analyze-drawings/index.ts` | Return `usage` from OpenAI response |
| `supabase/functions/summarize-analysis/index.ts` | Replace `getClaims` with `getUser` |
| `src/components/analysis/AnalysisSection.tsx` | White text + larger font for counts; "instances" label; token tracking; upload indicator; fix summarize timing |

