# Plan: WMSV DOCX export — embed highlighted drawing, one detection per page

## Root cause of the missing image

`generateAnalysisDocx` always downloads from the `drive-analysis-files` Supabase bucket. WMSV manual-upload projects store PDFs in `uploaded-drawings`, so `supabase.storage.from("drive-analysis-files").download(path)` returns a "not found" error and `renderDrawingImage` swallows it via its `try/catch`, producing `null`. Result: the DOCX has the table and file name but no image.

Secondary issue: even when the image renders, the bbox parser in the exporter is a brittle regex that ignores AI-bbox columns, has no text-layer fallback, and uses a different page-resolution path than the in-app viewer — so it can disagree with what the user sees on screen for many detections.

## Scope of changes

### Files edited
1. `src/lib/analysisDocxExporter.ts` — accept `sourceType`, route bucket, reuse the viewer's overlay-resolution logic, draw a red translucent circle (matching `OverlayLayer`), proportionally scale image, page-break before each detection.
2. `src/components/WMSVProjectDetail.tsx` — pass `request.source_type` into `generateAnalysisDocx(...)`.
3. `src/pages/AnalysisRequestDetail.tsx` — same call-site update so the Internal Analysis Queue export keeps parity.

No other files are touched. The shared viewer (`DrawingViewer`, `OverlayLayer`, `viewerGeometry`) is not modified.

## Change 1 — Bucket routing

**Signature change must not break existing call sites.** Keep `onProgress` in its existing position and append `sourceType` after it:

```ts
export async function generateAnalysisDocx(
  requestId: string,
  summaryData: Record<string, SummarizedInstance[]>,
  projectName: string,
  onProgress?: (done: number, total: number) => void,   // unchanged position
  sourceType?: string,                                   // NEW (appended)
): Promise<Blob>
```

All existing call sites (which pass 3 or 4 positional args) continue to work unchanged. New call sites pass `sourceType` as the 5th arg.

**`renderDrawingImage`** — accept `sourceType`, choose bucket:
```ts
const bucket = sourceType === "manual_upload" ? "uploaded-drawings" : "drive-analysis-files";
const { data: fileData, error } = await supabase.storage.from(bucket).download(storagePath);
```

**Call sites updated**
- `WMSVProjectDetail.tsx`: `generateAnalysisDocx(request.id, summaryData, projectName, undefined, request.source_type)`
- `AnalysisRequestDetail.tsx`: `generateAnalysisDocx(requestId, summaryData, request.project?.name, undefined, request.source_type)`

**What this fixes vs. what it doesn't:** Bucket routing fixes the storage fetch path so manual-upload PDFs can actually be downloaded. It does **not** by itself guarantee the DOCX shows an image or that the circle lands in the right spot — image inclusion and circle placement still depend on overlay/page resolution succeeding (Change 2). When those fail for a given detection, the export still succeeds, just without an image for that detection.

## Change 2 — Use the same overlay-resolution logic as the viewer

Replace the exporter's ad-hoc regex with the same path `InstanceDetailModal` uses:

1. Import the shared parser pieces:
   ```ts
   import { findBBoxInTextLayer, normalizeText } from "@/lib/pdfTextLayerSearch";
   ```
2. **Temporary narrow-scope duplication.** Copy three helpers from `AnalysisSection.tsx` into the exporter file: `parseOverlayCandidates`, `findMatchingOverlayRow`, `buildOverlaySearchCandidates`. **Keep the duplicated helper names and behavior identical to the viewer path** — same function names, same signatures, same output shape — so any future change in one place can be mirrored mechanically to the other.
   - **Follow-up note (out of scope here):** extract these three helpers into `src/lib/overlayCandidates.ts` and import from both `AnalysisSection.tsx` and `analysisDocxExporter.ts`. We accept the duplication temporarily to keep this diff narrow and reversible.
3. New `resolveDrawingOverlay(pdf, instance, resultText)` returns `{ pageNum, bbox: [x1,y1,x2,y2], coordSpace: "pixels" | "pdf-points", sourceViewport }` using the same priority as the viewer:
   - parse rows → match by `instance.id` (loose-bounded fallback)
   - if matched row has `aiBBox` → use `pixels` against the AI-reference viewport (`getViewport({ scale: 4 })`)
   - else iterate `searchCandidates` through `findBBoxInTextLayer` (`pdf-points`)
   - fallback: page from row.pageNum or 1, no bbox (no circle drawn, image still embedded)

This way the DOCX shows the same page and the same target as `InstanceDetailModal`.

## Change 3 — Red circle highlight matching the viewer

Replace the current "draw a red rect-derived circle" canvas code with the same geometry rule used by `OverlayLayer`:

```ts
// after rendering page to canvas at exportScale = 1.5:
if (overlay) {
  const [x1, y1, x2, y2] = overlay.bbox;
  let cx: number, cy: number, side: number;
  if (overlay.coordSpace === "pixels") {
    // overlay.sourceViewport was scale 4; rescale to current canvas
    const k = exportScale / 4;
    cx = ((x1 + x2) / 2) * k;
    cy = ((y1 + y2) / 2) * k;
    side = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) * k;
  } else {
    // pdf-points → use convertToViewportRectangle on the export viewport
    const [vx1, vy1, vx2, vy2] = exportViewport.convertToViewportRectangle([x1, y1, x2, y2]);
    cx = (vx1 + vx2) / 2;
    cy = (vy1 + vy2) / 2;
    side = Math.max(Math.abs(vx2 - vx1), Math.abs(vy2 - vy1));
  }
  const diameter = Math.max(34, side * 1.5);  // matches OverlayLayer rule
  ctx.beginPath();
  ctx.arc(cx, cy, diameter / 2, 0, 2 * Math.PI);
  ctx.fillStyle = "rgba(220, 38, 38, 0.22)";   // translucent red fill
  ctx.fill();
  ctx.strokeStyle = "rgb(220, 38, 38)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
}
```

Same translucent fill + thin red outline + same minimum diameter as the on-screen overlay.

## Change 4 — Page-break per detection + proportional image sizing

### Unit confirmed
**`docx@9.6.1` (this repo's installed version) treats `ImageRun.transformation.width` / `height` as PIXELS, not points.** Verified directly in `node_modules/docx/dist/index.cjs`: the values are multiplied by `9525` to produce EMU (1 pixel = 9525 EMU). All sizing math below uses pixels.

### Page break: hard guarantee
- Keep an explicit `PageBreak` paragraph before every detection after the first. **Reliable guarantee:** every detection starts on a new page.

### Keeping table + image together: best-effort
Word's renderer ultimately decides where content overflows. We use the standard hints:
- Mark every info-table row with `cantSplit: true` so a single row never breaks across a page.
- Apply `keepNext: true` to the spacer paragraph between table and image, and `keepLines: true` on the image paragraph.

These hints push Word to keep the table + image on the same page when content fits. If the combined block doesn't fit (very long control list, very tall source drawing), the image may flow to the next page. The page-break-before rule still holds — no two detections share a page. This is a known DOCX renderer limitation and not something the script can force.

### Proportional image sizing (in pixels)
- Have `renderDrawingImage` return `{ png, width: canvas.width, height: canvas.height }`.
- Compute display size in **pixels** (US Letter content area at 96 DPI ≈ 624 × 864 px; we leave room for the table):
  ```ts
  const MAX_W_PX = 620;   // ~6.5 inches at 96 DPI
  const MAX_H_PX = 720;   // ~7.5 inches at 96 DPI — leaves room for table
  const ratio = img.width / img.height;
  let w = MAX_W_PX, h = MAX_W_PX / ratio;
  if (h > MAX_H_PX) { h = MAX_H_PX; w = MAX_H_PX * ratio; }
  ```
- Pass `{ width: Math.round(w), height: Math.round(h) }` into `ImageRun.transformation`.

This replaces the current fixed `468 × 550` (which distorts and frequently overflows). Shrinking the image first is preferred over allowing overflow.

### No-image case
Exporter already handles this. Detection still gets its own page (page break before it), table only.

## Validation steps after implementation

1. WMSV manual-upload project: export DOCX → every detection has a red circle on the correct page; one detection per page.
2. WMSV with Drive: export still works, image present.
3. Internal Analysis Queue Drive request: behavior unchanged plus circle treatment matches the in-app marker.
4. Detection where text-layer / AI bbox cannot resolve: section renders with table only, page break still applied, export still succeeds.

## Limitations that remain

- Keeping a detection's table + image on the same physical page is best-effort. The hard guarantee is page-break-before each detection. With very long control lists or tall drawings, Word may still push the image to the following page even with `cantSplit` + `keepNext` + `keepLines`.
- `pdf-points` overlays are converted with `convertToViewportRectangle` against the export viewport; tiny sub-pixel drift versus the on-screen render is possible but visually indistinguishable.
- Exporter runs in the browser tab; very large requests (hundreds of detections) may take a while because PDFs are downloaded once per detection. Caching downloaded PDFs by `storage_path` within a single export run is a small follow-up — explicitly out of scope here.
- Helpers `parseOverlayCandidates` / `findMatchingOverlayRow` / `buildOverlaySearchCandidates` are duplicated into the exporter as a temporary narrow-scope duplication. Follow-up: extract them into `src/lib/overlayCandidates.ts` and have both `AnalysisSection.tsx` and the exporter import from one place.
