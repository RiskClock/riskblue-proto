

# Fix Upload Indicator, Token Position, and 520 Retry

## Issues

### 1. Upload indicator never appears
The upload indicator only shows when the first analysis call for a file triggers a fresh upload to OpenAI. However, if the file already has a cached `openai_file_id` (from a previous run), the upload path is skipped entirely (lines 1995-2001), so `uploadingFileIds` is never populated. Even on first runs, the indicator is set and cleared within the same synchronous `handleAnalyzeAllV2` loop iteration, which may not give React enough time to render between the `set` and `delete`.

**Fix**: Move the upload indicator to wrap ALL file processing (not just the upload branch). Show "Uploading" when a file lacks a cached ID, or show a different indicator (e.g., "Preparing") when cached. Also ensure the indicator persists visibly by not clearing it until the first analysis call for that file completes.

### 2. Token tracker position
Currently the analyze section orders elements as: Model dropdown → Progress/Stop → Tokens. The triage section orders: Progress → Info/Tokens → Stop/Triage button. The user wants the analyze token display to appear **before** the "Analyzing: x/y instances" text, matching triage.

**Fix**: Reorder the analyze toolbar so token info/live count appears immediately after the model dropdown, before the progress text and Stop/Analyze buttons.

### 3. OpenAI 520 error — no retry
The `analyze-drawings` edge function treats ALL non-OK HTTP responses from the Responses API as fatal failures. A 520 is a transient Cloudflare error that would likely succeed on retry.

**Fix**: Add retry logic in the edge function's `callResponsesApi` function for 5xx status codes (up to 2 retries with exponential backoff). This prevents transient OpenAI/Cloudflare errors from failing the entire cell.

## Files Changed

| File | Change |
|---|---|
| `src/components/analysis/AnalysisSection.tsx` | Fix upload indicator to show during the upload+first-analyze call; reorder token display before progress text in the analyze toolbar |
| `supabase/functions/analyze-drawings/index.ts` | Add retry loop (max 2 retries, exponential backoff) around `callResponsesApi` for 5xx HTTP errors |

