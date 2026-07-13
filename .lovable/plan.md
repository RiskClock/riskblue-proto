## Goal

Replace low-resolution PNG exports with true vector PDFs. Overlays (annotation dots, labels, Detail-N boxes) are pixel-identical to the on-screen viewer because they're captured as a transparent PNG from the same `DrawingViewer` used in the UI, then stamped onto the original vector PDF page via `pdf-lib`.

## User-visible changes

### 1. Per-page "Download" in the drawing modal (`FileViewerModal`)
- Replace the `Fit page` (Maximize2) button in `ViewerToolbar` with a `Download` button.
- Clicking opens a small dialog for that page only:
  - Filename preview: `{FileName}_page{N}.pdf`
  - Checkbox: **Include annotations & detail boxes** (default: on)
  - Buttons: Cancel / Download
- Output: single-page PDF = original vector page + optional overlay stamp.

### 2. Bulk "Download all files" on Workbench Project Detail
- Existing button (currently "Download all files (ZIP)") no longer downloads immediately. It opens a dialog:
  - Table of file groups (one row per file, all checked by default)
    - Columns: checkbox · file name · pages (e.g. "3 pages")
    - Non-PDF files listed but checkbox disabled with muted "PDF only" note.
  - Checkbox: **Include annotations & detail boxes** (default: on)
  - Estimated output filename: `{Project} - Drawings.pdf`
  - Buttons: Cancel / Download
- Output: **single multi-page PDF** merging every page of every selected PDF file, in file → page order, each page vector + optional overlay stamp.

### 3. Under the hood
- Loads each source PDF once via `supabase.storage`, caches bytes across selected pages of the same file.
- pdf.js scale stays at 1.5; the vector PDF page is kept vector, so no resolution question — quality equals the source PDF.
- Overlay resolution is bumped to `outScale: 3` when captured for stamping (only affects overlay pixels, which are small on the page).

## Technical details

### New file: `src/lib/pdfPageOverlayExport.ts`

- `captureOverlayLayerPng(source, page, overlays)` — Mounts a hidden `DrawingViewer` with the PDF image hidden (`img { visibility: hidden }`), waits for overlay layout to stabilize (reuses `waitForViewerReady`), then rasterizes only the overlay subtree onto a transparent canvas at `outScale: 3`. Returns `{ pngBytes, cssPageAspect }`.
- `buildAnnotatedPdf(entries, { includeOverlays })` where each entry = `{ sourceBytes, pages: number[], overlaysByPage, fileName }`
  - Uses `pdf-lib` (`PDFDocument.load` → `copyPages` → `drawImage` on top of each copied page using its `MediaBox` dimensions).
  - Returns a single `Uint8Array` for the merged PDF.
- `downloadSinglePagePdf(...)` convenience wrapper for the drawing-modal flow.

### `src/components/viewer/ViewerToolbar.tsx`
- Accept new optional `onDownload?: () => void` prop.
- Render a `Download` icon button in place of the fit-page button when `onDownload` is set. If both are provided, `onDownload` wins (fit-page is dropped as spec'd).

### `src/components/viewer/DrawingViewer.tsx`
- Thread new `onDownload` prop from `DrawingViewerProps` into `ViewerToolbar`.

### `src/components/wizard/FileViewerModal.tsx`
- Add local state for the download dialog + `includeOverlays` checkbox.
- Pass `onDownload={() => setShowDownloadDialog(true)}` to `DrawingViewer`.
- On confirm: fetch source PDF bytes, capture overlays for current page (if enabled), call `buildAnnotatedPdf` with a single entry/page, trigger download.

### New component: `src/components/workbench/BulkDrawingDownloadModal.tsx`
- Props: `open`, `onOpenChange`, `fileGroups`, `overlaysByFilePage`, `bucketForSource`, `projectName`.
- Renders the file table + `Include annotations & detail boxes` checkbox.
- On confirm: iterates selected PDFs, downloads bytes (cached), captures overlays per page in sequence (single hidden mount reused where possible), calls `buildAnnotatedPdf`, downloads merged PDF.

### `src/pages/WorkbenchProjectDetail.tsx`
- Replace `handleDownloadAllFiles` with `setShowBulkDownload(true)`.
- Mount `<BulkDrawingDownloadModal>` and pass current file groups + the overlay lookup already used by the Threat Report renderer.

### Dependencies
- Uses `pdf-lib` (already in the project via `analysisDocxExporter` / `threatReportExport`; no new install).

## Non-goals / unchanged

- WMG doc report, Threat Report DOCX, and existing per-page in-app PNG button all keep their current behavior — only new/replacement download entry points use the new vector pipeline.
- No changes to overlay data, RLS, edge functions, or storage buckets.
- No re-implementation of the label collision optimizer; overlays are captured from the same optimizer output the viewer already runs.

## Verification

1. Build passes typecheck.
2. Manual: open drawing modal → Download → confirm → single-page PDF opens with vector text and overlays that visually match the viewer.
3. Manual: workbench → Download all → uncheck one file → confirm → merged multi-page PDF contains only selected files' pages in order, overlays present when toggle on and absent when toggle off.
