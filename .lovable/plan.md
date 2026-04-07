

# New File-First Analyze Workflow (V2)

## Summary

Add a new "Analyze V2" workflow that iterates **file-by-file** instead of class-by-class. For each processed file, it uploads once to OpenAI, then fires analysis calls for all eligible AWP classes using that same `file_id`. The original analyze function is preserved behind a smaller icon-only button.

## UI Changes (AnalysisSection.tsx)

1. **Original "Analyze" button** — triggers the new `handleAnalyzeAllV2` workflow (file-first, 5 concurrent calls).
2. **New small icon-only button** (magnifying glass, no text) — placed immediately after, triggers the old `handleAnalyzeAll` (class-first, preserved as fallback).

## New Analyze Workflow: `handleAnalyzeAllV2`

### Flow

```text
1. Collect all enabled AWP classes (filter by !disabled, detection_method=drawing)
2. Collect all "processed" files (extractedFileIds)
3. For each file:
   a. Determine eligible AWP classes (triage score >= 50% OR manual include)
   b. If no eligible classes, skip file
   c. Ensure file has an OpenAI file_id (reuse cached or call edge function to upload)
   d. For each eligible class, queue a Responses API call
4. Execute queued calls with concurrency=5
5. Store results in analysis_results (same as today)
6. After all calls for a class finish, trigger summarize
```

### Triage filter (per user preference)
- Include cells where triage score >= 50% OR override = 'include'
- Exclude cells where override = 'exclude'
- Skip untriaged cells

### Concurrency
- Max 5 in-flight calls at a time across all files/classes
- Queue structure: array of `{ fileId, openaiFileId, awpClassName, promptContent }` work items
- Process queue with a pool of 5 workers

### Prompt fetching
- Fetch each class's prompt content per-class (via `resolve-drive-doc` with `exportContent: true`), same as current approach, but pre-fetch all needed prompts before starting the queue

### Edge function modification
- Add an optional `openaiFileId` parameter to `analyze-drawings`
- When provided, skip the upload step entirely and use the supplied `openaiFileId` directly for the Responses API call
- All existing caching, raster-fallback, and retry logic still applies when `openaiFileId` is NOT provided

### File upload strategy
- Before queuing calls for a file, check if the file already has a cached `openai_file_id` in the DB (via `shouldReuseFile` logic on the client side using the already-fetched `analysis_request_files` data)
- If not cached, call `analyze-drawings` once for that file (first class) WITHOUT `openaiFileId` — it will upload and cache it. Extract the returned `openaiFileId` from the edge function response (needs a small addition to the response payload)
- Subsequent classes for the same file pass the cached `openaiFileId`

**Simpler approach**: Add a new lightweight edge function or endpoint that just uploads the file to OpenAI and returns the `file_id`. Then all Responses API calls use the pre-uploaded `file_id`.

Actually — cleaner: modify `analyze-drawings` to accept optional `openaiFileId`. When provided, skip upload entirely. The client orchestrates: for each file, the first call lets the edge function upload normally; subsequent calls for the same file pass the `openaiFileId` from the first call's response.

### Response payload change
- `analyze-drawings` already returns `{ status, resultText, fileId, fileName }` — add `openaiFileId` to the response so the client can reuse it for subsequent calls on the same file.

## Files Changed

| File | Change |
|---|---|
| `supabase/functions/analyze-drawings/index.ts` | Accept optional `openaiFileId` param; skip upload when provided; include `openaiFileId` in response |
| `src/components/analysis/AnalysisSection.tsx` | Add `handleAnalyzeAllV2` (file-first, concurrency=5, 50% threshold); rewire main Analyze button to V2; add small icon-only button for legacy `handleAnalyzeAll` |

