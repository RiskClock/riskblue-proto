# Plan: Fix WMSV DOCX export — embed source drawing with red-circle highlight, one detection per page

## Verified facts (before coding)

- **Installed library**: `docx@^9.6.1`. Confirmed `cantSplit` (TableRow), `keepNext` and `keepLines` (Paragraph), and `SectionType.NEXT_PAGE` (`"nextPage"`) all exist in this version's compiled output.
- **Viewer overlay-resolution code lives in `src/components/analysis/AnalysisSection.tsx`** (not in a shared lib): `parseOverlayCandidates`, `findMatchingOverlayRow`, `buildOverlaySearchCandidates`, plus the `InstanceDetailModal.useEffect` that runs the resolve. It uses `findBBoxInTextLayer` from `src/lib/pdfTextLayerSearch.ts`. `LocationDetailsModal` has its own copy of similar logic — out of scope here.
- **Resolver outputs** (per modal): `{ pageNum, bbox, coordSpace: 'pixels' | 'pdf-points', pixelSize?, pdfViewport? }`. AI bbox is in scale=4 raster pixels; text-layer bbox is in PDF user-space points.
- **Confirmed in-app fallback when nothing resolves**: `setResolvedOverlay(null)` and the modal renders the page with no overlay AND no auto-page selection — i.e., the viewer shows page 1 only because it is the viewer's natural default for browsing. There is **no confirmed product fallback that says "page 1 = correct page"** for an unresolved detection.
- **WMSV bucket**: manual uploads go to `uploaded-drawings`; everything else to `drive-analysis-files`. Confirmed by `InstanceDetailModal` line: `const bucket = sourceType === "manual_upload" ? "uploaded-drawings" : "drive-analysis-files"`.

## Root cause of current export bug

In `src/lib/analysisDocxExporter.ts`:

1. **Bucket mismatch**: `renderDrawingImage` always downloads from `drive-analysis-files`. WMSV manual uploads silently fail and the image is omitted.
2. **Inline overlay logic is too narrow** vs. the in-app viewer:
   - Page parsing is a single `\| <num> \|` regex against the row containing `instanceId` — misses the real markdown table column structure used by the viewer.
   - BBox parser only catches `(x1, y1) → (x2, y2)` tuples and treats them as render-canvas pixels at `scale=1.5`. The actual AI bbox is in the **scale=4 raster** (per `InstanceDetailModal`), so even when found the circle is drawn in the wrong place.
   - No text-layer fallback (`findBBoxInTextLayer`) when no AI bbox is provided.
3. **Image transform uses fixed `468 × 550` regardless of source aspect ratio**, so circles distort and detections can spill onto a second page.

## Files to change

- `src/components/WMSVProjectDetail.tsx` — pass `request.source_type` into the exporter.
- `src/lib/analysisDocxExporter.ts` — bucket selection by `sourceType`, real overlay resolution via the shared resolver, true aspect-ratio image scaling, strict one-detection-per-page layout.
- `src/lib/analysisOverlayResolver.ts` — **new**, minimal shared resolver. Will contain only the small surface both call-sites need.
- `src/components/analysis/AnalysisSection.tsx` — switch to importing the shared resolver functions; behavior unchanged.

## Change 1 — Source bucket selection (smallest safe fix)

**`WMSVProjectDetail.tsx` (`handleExportDocx`)**
```ts
const blob = await generateAnalysisDocx(
  request.id,
  summaryData as any,
  projectName || "Project",
  undefined,                       // onProgress
  request.source_type ?? undefined,
);
```

**`analysisDocxExporter.ts`**
```ts
export async function generateAnalysisDocx(
  requestId: string,
  summaryData: Record<string, SummarizedInstance[]>,
  projectName: string,
  onProgress?: (done: number, total: number) => void,
  sourceType?: string,
): Promise<Blob>

async function renderDrawingImage(
  storagePath: string | null,
  instance: { id: string; name: string },
  resultText: string | null,
  sourceType?: string,
): Promise<{ bytes: Uint8Array; widthPx: number; heightPx: number } | null> {
  const bucket = sourceType === "manual_upload" ? "uploaded-drawings" : "drive-analysis-files";
  // …
}
```
`sourceType` is threaded through from `generateAnalysisDocx` → loop → `renderDrawingImage`.

## Change 2 — Extract minimal shared resolver

**New file `src/lib/analysisOverlayResolver.ts`** — moves only the four pieces both call-sites need, identical behavior:

```ts
export interface OverlayRow { /* same shape as in AnalysisSection */ }
export interface ResolvedInstanceOverlay {
  pageNum: number;
  bbox: [number, number, number, number];
  coordSpace: "pixels" | "pdf-points";
  pixelSize?: { w: number; h: number };
  pdfViewport?: pdfjsLib.PageViewport;
}

export function parseOverlayCandidates(resultText: string): OverlayRow[]
export function findMatchingOverlayRow(rows: OverlayRow[], targetId: string): OverlayRow | undefined
export function buildOverlaySearchCandidates(row: OverlayRow | undefined, instance: { id: string; name: string }): string[]

/**
 * Resolves a detection's overlay against the source PDF using the same
 * priority the in-app viewer uses (AI bbox → text-layer search). Returns
 * null when nothing matches — caller decides whether to render the page.
 */
export async function resolveInstanceOverlay(opts: {
  pdf: pdfjsLib.PDFDocumentProxy;
  instance: { id: string; name: string };
  resultText: string | null;
}): Promise<ResolvedInstanceOverlay | null>
```

`AnalysisSection.tsx` is updated to import these (drops its private copies). The `InstanceDetailModal.useEffect` keeps its existing flow but reads `parseOverlayCandidates` etc. from the shared module — visible behavior unchanged.

## Change 3 — Use the shared resolver in the exporter

`renderDrawingImage` becomes:

```ts
const { data: fileData, error } = await supabase.storage.from(bucket).download(storagePath);
if (error || !fileData) return null;
const ab = await fileData.arrayBuffer();
const pdf = await pdfjsLib.getDocument({ data: ab }).promise;

const resolved = await resolveInstanceOverlay({
  pdf,
  instance,
  resultText,
});

// Per spec: do NOT render page 1 by default when resolution fails.
if (!resolved) return null;

const page = await pdf.getPage(Math.min(resolved.pageNum, pdf.numPages));

// Match the viewer's raster scale so AI pixel bboxes line up exactly.
const renderViewport = page.getViewport({ scale: 4 });
const canvas = document.createElement("canvas");
canvas.width = renderViewport.width;
canvas.height = renderViewport.height;
const ctx = canvas.getContext("2d")!;
await page.render({ canvasContext: ctx, viewport: renderViewport, canvas } as any).promise;

// Compute circle on the raster using the same math as the in-app overlay.
let circle: { cx: number; cy: number; r: number } | null = null;
if (resolved.coordSpace === "pixels" && resolved.pixelSize) {
  const [x1, y1, x2, y2] = resolved.bbox;
  const sx = renderViewport.width / resolved.pixelSize.w;
  const sy = renderViewport.height / resolved.pixelSize.h;
  const cx = ((x1 + x2) / 2) * sx;
  const cy = ((y1 + y2) / 2) * sy;
  const side = Math.max(Math.abs(x2 - x1) * sx, Math.abs(y2 - y1) * sy);
  circle = { cx, cy, r: Math.max(34, side * 1.5) / 2 };
} else if (resolved.coordSpace === "pdf-points" && resolved.pdfViewport) {
  const vr = resolved.pdfViewport.convertToViewportRectangle(resolved.bbox);
  const [vx1, vy1, vx2, vy2] = vr;
  const cx = (vx1 + vx2) / 2;
  const cy = (vy1 + vy2) / 2;
  const side = Math.max(Math.abs(vx2 - vx1), Math.abs(vy2 - vy1));
  circle = { cx, cy, r: Math.max(34, side * 1.5) / 2 };
}

if (circle) {
  ctx.beginPath();
  ctx.arc(circle.cx, circle.cy, circle.r, 0, 2 * Math.PI);
  ctx.fillStyle = "rgba(220, 38, 38, 0.22)";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgb(220, 38, 38)";
  ctx.stroke();
}

const blob = await new Promise<Blob | null>(r => canvas.toBlob(b => r(b), "image/png", 0.85));
if (!blob) return null;
return { bytes: new Uint8Array(await blob.arrayBuffer()), widthPx: canvas.width, heightPx: canvas.height };
```

**Caching is deferred.** Repeated detections on the same file/page will re-download and re-render. The implementation is straightforward to memoize later by `(storagePath, pageNum)` if it becomes a perf issue.

## Change 4 — True aspect-ratio image scaling using docx's documented units

`docx@9.6.1` `ImageRun.transformation.{width,height}` are documented in **pixels at 96 DPI** (the library converts to EMU internally). To stay portable across renderers, derive the budget from the actual page geometry:

- **Image width budget (pixels @ 96 DPI)**: `contentWidthDXA / 1440 * 96`. For US Letter 1″ margins → `9360 / 1440 * 96 = 624 px`.
- **Image height budget (pixels @ 96 DPI)**: `(pageHeightDXA - topMargin - bottomMargin - infoTableEstimateDXA) / 1440 * 96`. For US Letter with the 9-row info table (~2400 DXA at our row sizing + 200 spacing), this gives roughly `(15840 - 1440 - 1440 - 2700) / 1440 * 96 ≈ 670 px`. We will use **620 × 620** as a conservatively tested budget that we verify with a real generated DOCX before shipping.

```ts
// Use the canvas dimensions returned by renderDrawingImage.
const MAX_W_PX = 620;
const MAX_H_PX = 620;
const aspect = img.widthPx / img.heightPx;
let w = MAX_W_PX;
let h = MAX_W_PX / aspect;
if (h > MAX_H_PX) { h = MAX_H_PX; w = MAX_H_PX * aspect; }

new ImageRun({
  type: "png",
  data: img.bytes,
  transformation: { width: Math.round(w), height: Math.round(h) },
  altText: { /* … */ },
})
```

The exact `MAX_W_PX` / `MAX_H_PX` budget will be tuned after generating a sample export and visually checking that one detection (info table + image) fits on one US-Letter page in Word. If it overflows, the budget is reduced; the calculation above keeps aspect ratio either way.

## Change 5 — Strict one-detection-per-page layout

Two layers of enforcement, using only verified APIs:

**(a) Section per detection** — every detection (after the first) starts on a new page deterministically:

```ts
sections: rows.map((row, idx) => ({
  properties: {
    type: idx === 0 ? SectionType.CONTINUOUS : SectionType.NEXT_PAGE,
    page: {
      size:   { width: 12240, height: 15840 },
      margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
    },
  },
  children: buildDetectionBlock(row),
}))
```

**(b) Keep-together hints inside a detection block:**

- Every `DocxTableRow` of the info table: `cantSplit: true`.
- Every `Paragraph` in the detection block: `keepNext: true, keepLines: true` (the *last* paragraph of the block does not need `keepNext`, but setting it is harmless).

These three properties are confirmed present in the installed `docx@9.6.1` build (`w:cantSplit`, `w:keepNext`, `w:keepLines` emitters in `dist/index.cjs`).

## Behavior when an image cannot be resolved

Per the user's adjustment: **omit the image, do not render page 1 as a fallback.** The detection block becomes "info table only" on its own page, which is honest and avoids misleading exports.

## Acceptance criteria

- `request.source_type === "manual_upload"` → exporter pulls PDFs from `uploaded-drawings`. ✓
- Other source types → `drive-analysis-files`. ✓
- Red circle is drawn from the same `(pageNum, bbox, coordSpace)` the in-app modal computes; pixel bboxes correctly map at scale=4; text-layer fallback works. ✓
- Detections with no resolvable overlay export with **no image** (no page 1 fallback). ✓
- One detection per page enforced via `SectionType.NEXT_PAGE` + `cantSplit` + `keepNext`/`keepLines`. ✓
- Image scales using its real PNG dimensions returned by the renderer; aspect ratio preserved. ✓
- Existing info-table content order preserved. ✓

## Known limitations (renderer-dependent)

- One-detection-per-page is **strongly enforced within Word/docx constraints** (a new section with `NEXT_PAGE` is the strongest portable signal we have). In practice Word, LibreOffice Writer, and Pages all honor it. Google Docs and other DOCX renderers may apply their own pagination heuristics that can occasionally split very tall content; this is a property of those renderers, not the document.
- Image fit-on-one-page uses a tested width/height budget. On exports with unusually long info-table values (many controls, very long file names) wrapping may push the image down; in that case the renderer will move the image to the next page in spite of `keepNext`. Tightening the budget further is a tunable response if this is observed.
- Text-layer fallback requires the source PDF to contain a text layer. Pure raster PDFs with no text layer and no AI bbox will produce no resolved overlay → no image, by design.
- Caching of repeated `(file, page)` renders is deferred; not needed for correctness.
