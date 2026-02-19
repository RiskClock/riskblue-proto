
# Two Fixes: Live Count Updates During Analysis · PDF Bytes Re-fetched on Cache Miss

## Issue 1: Counts don't update as files complete

### Root cause
`countForCell` reads from the `results` React Query cache (line 1216):
```typescript
const result = results?.find((r) => r.file_id === fileId && r.awp_class_name === className);
```
This query (`queryKey: ["analysis-results", requestId]`) is only invalidated **once**, at the very end of the entire loop (line 1080):
```typescript
await queryClient.invalidateQueries({ queryKey: ["analysis-results", requestId] });
```
That means while the ERM column is analyzing 11 files sequentially, the grid shows spinners for each file as they process but **the count cells only populate all at once after the last file finishes**. The user sees nothing change until completion.

### Fix
Invalidate the results query **after each individual file** completes successfully, not just at the end of the loop. Move `queryClient.invalidateQueries(...)` inside the per-file loop, right after the status is updated to `complete`:

```typescript
// Inside the for...of loop, after:
setClassFileStatuses((prev) => ({
  ...prev,
  [className]: {
    ...(prev[className] || {}),
    [file.id]: analyzeResponse.ok ? "complete" : "failed",
  },
}));

// Add immediately after:
if (analyzeResponse.ok) {
  await queryClient.invalidateQueries({ queryKey: ["analysis-results", requestId] });
}
```

Keep the existing post-loop invalidation as a final safety flush (it's cheap and idempotent).

This makes `countForCell` immediately re-read from DB for that file so its count appears as soon as the edge function returns — while the next file's spinner appears in parallel.

---

## Issue 2: OpenAI receives reference (file_id) with expired/invalid file → "raster image provided"

### Root cause — the cache hit path sends only a `file_id`, not bytes

When `shouldReuseFile()` returns `true`, the code takes the **cache hit branch** (line 202–205):
```typescript
if (shouldReuseFile(fileRecord) && !mimeWasCorrected) {
  openaiFileId = fileRecord.openai_file_id as string;   // just an ID string
  // NO download, NO blob, NO byte verification
}
```
The cached `openai_file_id` is then sent to the Responses API. If that file has expired on OpenAI's side **but our local TTL/expiry hasn't caught it yet** (e.g., the expiry field wasn't returned or is slightly off), OpenAI silently falls back to treating the request as image-only and says "original PDF not provided."

Additionally, there's no log confirming what MIME type and byte size the *cache-hit* path eventually sends — because it sends nothing, only a file_id reference. The user's note is correct: "we must re-fetch the PDF bytes from storage whenever the cached file is expired and attach it as `application/pdf`." But the subtler issue is that even non-expired cached files can be silently stale if OpenAI's actual TTL doesn't match what `expires_at` says.

### Fix — Add detailed logging before the Responses API call to confirm the file reference

Since the cache hit path sends only a file_id (no bytes — that's how OpenAI file refs work), we need to confirm **at the Responses API call site** what we're sending:

```typescript
// Just before the fetch to /v1/responses:
console.log(`[analyze-drawings] Responses API call: file_id=${openaiFileId}, fileRecord.name=${fileRecord.name}, effectiveMime=${effectiveMime}, cacheHit=${shouldReuseFile(fileRecord) && !mimeWasCorrected}`);
```

Also add logging inside the **upload path** confirming actual blob size:
```typescript
console.log(`[analyze-drawings] Uploading to OpenAI: name=${fileRecord.name}, mime=${effectiveMime}, blobSize=${pdfBlob.size} bytes`);
```

### Fix — Force fresh re-upload if the Responses API response indicates raster fallback

Add a check on the successful Responses API response: if `resultText` contains the phrase `"raster image"` or `"original PDF not"` (indicators the model fell back), treat the cached file as invalid and **immediately re-upload** by:
1. Setting `openai_file_status = "invalid"` on the file record
2. Updating the result as `failed` with message `"Model received raster image instead of PDF — cached file expired. Re-analyze to re-upload."`
3. Returning a 422 so the frontend marks the cell as failed (not silently 0)

This turns a silent wrong result into a visible failure that prompts the user to click Re-analyze, which will then correctly re-upload the PDF bytes.

```typescript
// After extracting resultText, before storing:
const rasterFallbackDetected =
  resultText.toLowerCase().includes("raster image") ||
  resultText.toLowerCase().includes("original pdf not");

if (rasterFallbackDetected) {
  // Invalidate cache so next run re-uploads
  await adminSupabase.from("analysis_request_files")
    .update({ openai_file_status: "invalid" })
    .eq("id", fileId);

  await adminSupabase.from("analysis_results")
    .update({
      status: "failed",
      error_message: "Model received raster image instead of PDF — cached OpenAI file expired. Re-analyze to re-upload.",
    })
    .eq("file_id", fileId)
    .eq("analysis_request_id", analysisRequestId)
    .eq("awp_class_name", awpClassName);

  return new Response(JSON.stringify({
    error: "Cached OpenAI file expired (model got raster image). Re-analyze to re-upload PDF.",
  }), {
    status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
```

### Additional logging for cache-hit vs. fresh-upload
Also add a log line right after the cache-hit decision to make it easy to confirm in logs:
```typescript
if (shouldReuseFile(fileRecord) && !mimeWasCorrected) {
  openaiFileId = fileRecord.openai_file_id as string;
  console.log(`[analyze-drawings] Cache hit for file ${fileId}: reusing OpenAI file_id=${openaiFileId}, uploadedAt=${fileRecord.openai_file_uploaded_at}, expiresAt=${fileRecord.openai_file_expires_at}`);
} else {
  // ...upload path with blob size log
}
```

---

## Files changed

| File | Change |
|---|---|
| `src/components/analysis/AnalysisSection.tsx` | Invalidate `["analysis-results", requestId]` query after each successful per-file completion inside the loop (not just after all files) |
| `supabase/functions/analyze-drawings/index.ts` | Add detailed logging at cache-hit and upload paths; detect raster-fallback in result text and fail fast with cache invalidation |

No DB changes. No new packages. No other files.

---

## Summary

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| 1 | Counts all appear at once at the end | `invalidateQueries` called once after the full loop | Move invalidation inside the loop, after each file completes |
| 2 | "raster image provided" = 0 detections, silently wrong | Cached file_id expired on OpenAI's side but local TTL didn't catch it | Detect raster fallback phrase in result text → fail fast + invalidate cache → user re-analyzes with fresh PDF upload |
