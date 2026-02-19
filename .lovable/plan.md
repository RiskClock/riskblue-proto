
# Four Fixes: PDF MIME Type for OpenAI Upload · Procore File Visibility · FilePreviewModal Zoom · parseResultText Fallback

## Root causes (all confirmed)

### 1. Critical: OpenAI receives `application/octet-stream` instead of `application/pdf`

From the database:
```
mime_type: application/octet-stream  (for every single Procore file)
name: A2.10-ROOF-PLAN-Rev.14.pdf
```

In `copy-procore-files`, Procore's API returns `content_type` as `application/octet-stream` (or nothing) for many files. This gets stored verbatim in `analysis_request_files.mime_type`.

In `analyze-drawings`, line 209:
```typescript
uploadForm.append("file", fileData, fileRecord.name);
```
`fileData` is a `Blob` downloaded from storage. Storage preserves the content-type it was uploaded with — which is `application/octet-stream`. So OpenAI receives a file with type `application/octet-stream`, treats it as a raster image, says "original PDF not provided", and refuses to return PDF-point bboxes.

**Fix**: In `analyze-drawings`, before uploading to OpenAI:
1. Add a PDF guardrail — if `mime_type !== "application/pdf"` AND filename doesn't end with `.pdf`, fail fast with a clear error: `"Detection requires a PDF file for PDF-point bboxes. This file appears to be: {mime_type}"`.
2. If `mime_type` is `application/octet-stream` but the filename ends with `.pdf`, reconstruct the Blob with `type: "application/pdf"` before appending to FormData. This ensures OpenAI receives `Content-Type: application/pdf` in the multipart boundary.

Also fix `copy-procore-files` to detect the MIME type from the filename for files Procore reports as `application/octet-stream`:
```typescript
function inferMimeType(filename: string, reported: string): string {
  if (reported && reported !== "application/octet-stream") return reported;
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return reported || "application/octet-stream";
}
```
Apply when building `fileRecords` and when uploading to storage.

**Add logging** in `analyze-drawings` before the OpenAI upload:
```typescript
console.log(`Uploading file ${fileId} to OpenAI: name=${fileRecord.name}, mime=${effectiveMime}, size=${fileData.size}`);
```
This confirms PDF bytes are sent.

**Cache invalidation**: The currently cached OpenAI file IDs for this analysis request were uploaded as `application/octet-stream`. They must be invalidated so a fresh upload happens with the correct MIME type. In `analyze-drawings`, after determining `effectiveMime`, if the cached file was uploaded before this fix (i.e., when `openai_file_status === "active"` but we now know mime was wrong), we should force re-upload. The simplest approach: add a check — if `effectiveMime === "application/pdf"` but the existing `openai_file_status` is `"active"` and `openai_file_uploaded_at` predates this fix, invalidate. Actually, the cleanest approach is: after computing `effectiveMime`, if it differs from `fileRecord.mime_type` (because we corrected `octet-stream` to `pdf`), force `shouldReuseFile` to return false by treating it as a cache miss. Implement this by checking: `const mimeWasWrong = effectiveMime !== fileRecord.mime_type` and if `mimeWasWrong`, skip the cache path entirely.

### 2. Procore file list: `hideFiles={true}` propagates recursively

In `ProcoreConnectionDialog.tsx` line 446: `hideFiles` is passed as `true` to `ProcoreFolderTree`. The component at line 148 passes `hideFiles={hideFiles}` recursively to all child trees. At line 152: `{!hideFiles && subData.files.map(...)}` — so files are never shown at any depth.

**Fix**: Change line 446 from `hideFiles` (shorthand for `hideFiles={true}`) to `hideFiles={false}`. Files inside expanded subfolders will then render.

### 3. FilePreviewModal: no zoom

The modal at lines 530–609 renders canvases into `containerRef.innerHTML` with no zoom state. It uses `max-h-[90vh]` but no zoom controls.

**Fix**: Refactor `FilePreviewModal` to match the `InstanceDetailModal` pattern:
- Add `zoom` state (default 1, range 0.25–4) and `scrollRef` for center-preserving scroll
- Change modal structure to `max-w-5xl h-[90vh] flex flex-col p-0` with:
  - Fixed header: file name + zoom controls (ZoomIn/ZoomOut buttons + `{Math.round(zoom * 100)}%` label)
  - Scrollable body: `ref={scrollRef}` + `flex-1 overflow-auto`
  - Inner wrapper: `style={{ transform: \`scale(\${zoom})\`, transformOrigin: 'top center', width: 'fit-content', margin: '0 auto', padding: '16px' }}`
- The canvases are stored in `pages` state (not appended via innerHTML), and rendered as React elements: `{pages.map((canvas, i) => <canvas key={i} ref={el => el && el !== canvas && el.replaceWith(canvas)} />)}` — actually simpler to use a `useEffect` that appends canvases into a ref div (as currently done), but with the zoom transform applied to the container
- Center-preserving zoom handlers (same as `InstanceDetailModal`'s `handleZoomIn`/`handleZoomOut`)

### 4. `parseResultText` fallback for numbered-list format

When OpenAI was receiving a raster image, it returned results in a different plain-text format (numbered entries like `1) Room tag: SWC-B03`). `parseResultText` found no pipe-table header → returned `[]` → all counts showed 0.

After the PDF mime fix, the model should return proper table format. But as a robustness measure, add fallbacks after the existing table parser:

```typescript
// Fallback 1: numbered entries like "1) " or "1. "
if (instances.length === 0) {
  const numberedMatches = resultText.match(/^\s*\d+[.)]\s/gm) || [];
  if (numberedMatches.length > 0) {
    return numberedMatches.map((_, i) => ({ id: String(i + 1), name: "-", level: "-", size: "-" }));
  }
}
// Fallback 2: "Total ... Found: N" or "Total: N"
if (instances.length === 0) {
  const totalMatch = resultText.match(/total[^:]*:\s*(\d+)/i);
  if (totalMatch) {
    const n = parseInt(totalMatch[1], 10);
    if (n > 0) return Array.from({ length: n }, (_, i) => ({ id: String(i + 1), name: "-", level: "-", size: "-" }));
  }
}
```

---

## Files changed

| File | Change |
|---|---|
| `supabase/functions/copy-procore-files/index.ts` | Add `inferMimeType()` helper; apply it when building file records and uploading to storage |
| `supabase/functions/analyze-drawings/index.ts` | Compute `effectiveMime` from filename if stored mime is `octet-stream`; add PDF guardrail (fail fast if not PDF); force cache miss if mime was corrected; add logging before upload |
| `src/components/wizard/ProcoreConnectionDialog.tsx` | Change `hideFiles` → `hideFiles={false}` at line 446 |
| `src/components/analysis/AnalysisSection.tsx` | Add zoom state + zoom controls to `FilePreviewModal`; add `parseResultText` fallbacks |

No DB changes. No new packages.

---

## Key implementation details

### `analyze-drawings` — MIME fix + guardrail

```typescript
// After downloading fileData blob:
const storedMime = fileRecord.mime_type as string | null;
const isPdfByName = fileRecord.name?.toLowerCase().endsWith(".pdf");
const effectiveMime = (storedMime && storedMime !== "application/octet-stream")
  ? storedMime
  : isPdfByName ? "application/pdf" : storedMime ?? "application/octet-stream";

// Guardrail: only PDFs are supported for PDF-point bbox detection
if (effectiveMime !== "application/pdf") {
  await adminSupabase.from("analysis_results")
    .update({ status: "failed", error_message: `Detection requires a PDF file. File type: ${effectiveMime}` })
    .eq("file_id", fileId).eq("analysis_request_id", analysisRequestId).eq("awp_class_name", awpClassName);
  return new Response(JSON.stringify({ error: `Detection requires a PDF file for PDF-point bboxes. File type: ${effectiveMime}` }), {
    status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Force cache miss if stored mime was wrong (previously uploaded as octet-stream)
const mimeWasCorrected = storedMime !== effectiveMime;

// In shouldReuseFile check:
if (shouldReuseFile(fileRecord) && !mimeWasCorrected) {
  // cache hit
} else {
  // Re-upload with correct mime type
  const pdfBlob = new Blob([await fileData.arrayBuffer()], { type: "application/pdf" });
  uploadForm.append("file", pdfBlob, fileRecord.name);
  // ... log: console.log(`Uploading ${fileId}: name=${fileRecord.name}, mime=application/pdf, size=${pdfBlob.size}`);
}
```
