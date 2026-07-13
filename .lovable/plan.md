# Fix Threat Report export — anchor drift, template-label drift, and label clipping

## Findings (deep investigation)

Threat Report has two independent rasterization pipelines for the same PDF page:

- **In-app preview** (`DrawingPageBlock` → `DrawingViewer` → `usePdfPageRaster.ts:41,197-201`): pdf.js at fixed `scale: 1.5`, overlays rendered by `OverlayLayer.tsx` in CSS pixels against `pageCssSize` (a fit-to-viewport size preserving aspect ratio).
- **DOCX export** (`runThreatReportExport` → `threatReportExport.ts:169-490 renderPageWithMarkers`): a **separate** pdf.js load and `page.getViewport({ scale: 1600/max(baseVp) })`, overlays drawn to canvas with their own from-scratch geometry / label optimizer.

Both consume the same `nx`/`ny` (0..1, page-relative — confirmed via `FileViewerModal.tsx:786-793` and `DocumentSurface.tsx:96-97`, and `WorkbenchProjectDetail.tsx:6535-6541,6564-6580`), so on paper the anchors should agree. In practice the export drifts because of a chain of independent implementations, each with its own constants and clamp/rounding rules:

1. **Dot/circle anchor drift** — the export re-rasterizes the PDF with a *different* target scale (up to 3× vs 1.5×) and independently rounds `cx = Math.round(o.nx * canvas.width)` / `cy = Math.round(o.ny * canvas.height)` (`threatReportExport.ts:194-195, 248-249`). Any sub-pixel viewport-rounding difference between the two pdf.js passes, plus the different rounding basis, produces the visible anchor offset the user is seeing between preview and PNG.
2. **Template-label ("Detail N" pink pills) drift** — these are `shape: "rect"` overlays for level/unit floor-plan bboxes (`WorkbenchProjectDetail.tsx:6564-6580`). The export draws them with its own hand-rolled placement (`threatReportExport.ts:191-217`), unrelated to the viewer's `OverlayLayer` rect logic. Same-nx/ny input, different placement algorithm → visible offset.
3. **Label clipping (confirmed)** — `threatReportExport.ts:208-209` clamps only the top/left edges of rect labels:
   ```
   const lx = Math.max(2, x);
   const ly = Math.max(2, y - labelH - 2);
   ```
   No `Math.min(canvas.width - tw - 2, …)` / `canvas.height - labelH - 2` clamp, so any pill near the right/bottom edge is silently drawn past the canvas and cut off in the PNG. (The circle-label path *does* clamp at `:341-342`; only rect labels are affected.)

**WMG doc report is not affected.** `WaterRiskReport.tsx` → `pdfExporter.ts:97` uses `html2canvas` on the already-rendered DOM, so it captures whatever the viewer shows pixel-for-pixel — no separate geometry.

**In-app `DrawingPageBlock` "Download PNG" button is also not affected.** It reads back the placed DOM (`WorkbenchProjectDetail.tsx:7154-7319`) and redraws onto canvas, guaranteeing parity with the preview.

The odd one out is `renderPageWithMarkers` in `threatReportExport.ts`: an independent reimplementation of both PDF rasterization and overlay placement.

## Fix — capture the live viewer instead of reimplementing

Replace `renderPageWithMarkers`'s from-scratch pdf.js + hand-drawn-overlay pipeline with the same WYSIWYG approach already used by `DrawingPageBlock`'s Download button and the WMG report: mount the real `DrawingViewer` offscreen for each page, wait for it to render, then snapshot the DOM to a canvas. This automatically eliminates all three defects (anchor drift, template-label drift, label clipping) because the exported bitmap is literally the viewer.

1. **New helper `src/lib/threatReportPageCapture.ts`**
   - Exports `capturePageToPng(pageRef, opts) → { blob, width, height }`.
   - Creates a hidden container (`position: fixed; left: -100000px; width/height sized for ~1600 px long edge; visibility: hidden`) and mounts a `<DrawingViewer>` into it via `createRoot`, using the same `source`/`page`/`overlays` the preview uses (`DrawingPageBlock` props already carry this).
   - Configure the viewer for capture: `showToolbar={false}`, `interactive={false}`, `initialFit="page"`, `hidePageNav`, and disable animations by setting `initialFit` before mount.
   - Await readiness: `onApiReady` + `onActivePageRenderedSizeChange` + a `requestAnimationFrame` pair, then poll for the overlay DOM (`[data-overlay-root]` — add this data attribute in `OverlayLayer.tsx` root if not already present) to have expected child count.
   - Rasterize: reuse the exact DOM-readback drawing routine from `DrawingPageBlock.handleDownload` (`WorkbenchProjectDetail.tsx:7154-7319`); refactor that logic into a shared function `rasterizeViewerSurface(surfaceEl, opts) → Promise<{ blob, width, height }>` in the new helper and call it from both places.
   - Unmount and remove the container in `finally`.

2. **Refactor `src/lib/threatReportExport.ts`**
   - Delete `renderPageWithMarkers` (lines 169-490) and its supporting inline geometry/optimizer helpers.
   - Where DOCX assembly currently calls `renderPageWithMarkers(pdf, pageIdx, overlays)`, call `capturePageToPng(pageRef, { targetLongEdgePx: 1600 })` instead.
   - Drop the now-unused pdf.js `getDocument`/PDF cache in this file (the viewer already caches via `documentCache.ts`).

3. **Refactor `src/pages/WorkbenchProjectDetail.tsx`**
   - Extract `DrawingPageBlock.handleDownload`'s DOM-readback loop into `rasterizeViewerSurface` in the new helper (step 1). `DrawingPageBlock` continues to use it — behavior unchanged for the in-app PNG button (confirms the shared code path stays correct).

4. **Small correctness follow-ups**
   - Add `data-overlay-root` on `OverlayLayer.tsx` root `<svg>`/wrapper so `capturePageToPng` can deterministically detect overlay readiness.
   - Keep DOCX embedding code, page ordering, tab labels, and progress reporting (`setExportProgress`) untouched — only the "produce a PNG for this page" step changes.

## Verification

- Manual: open Threat Report modal for the same project/level (e.g. L02 from the screenshots), export DOCX, open both side-by-side. Expected: every dot lands on the same pixel of the same drawing feature; every "Detail N" pill lands in the same place; no labels are clipped at edges.
- Compare a page with an annotation near the right edge of the page to confirm right-edge clipping is gone (the previous export truncated pills there).
- WMG report unaffected — no changes to `WaterRiskReport.tsx` / `pdfExporter.ts`.

## Out of scope

- No DB, RLS, or edge-function changes.
- No changes to how `nx`/`ny` are computed or stored — confirmed correct and shared across both paths.
- No visual redesign of overlays; the export will simply match the viewer's current look exactly.
