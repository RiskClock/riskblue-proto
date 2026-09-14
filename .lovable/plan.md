# Faster downloads when annotations are included

## What happens today

With the annotations checkbox ticked:

- A file that has **no** annotations at all is already skipped — its original PDF goes straight into the ZIP untouched. So in a project with no detections, ticking the box costs nothing.
- A file that has annotations on **any** page is fully rebuilt: every page is copied into a brand-new PDF and the whole document re-saved, even the pages with nothing on them. Drawing the annotation picture itself is only done on pages that actually have annotations — the waste is the page-by-page copy and re-save of the rest.

So the answer is: untouched files are already fast, but a 60-page file with two annotated pages currently pays the cost of rebuilding all 60 pages.

## What changes

1. **Stamp in place instead of rebuilding.** Open the original file, draw the annotations onto just the pages that need them, and save the same document. No page-by-page copy into a new file. This is the main win for annotated files.
2. **Touch only the pages that need work.** Pages with no annotations and no rotation are skipped entirely, including the periodic pauses that currently run for every page.
3. **Rotation-only files stay cheap.** If a file only needs pages rotated (no annotations), just set the rotation and save — no annotation rendering at all.
4. **Faster save format.** Save without object streams, which is measurably quicker for large drawing files and produces a file every reader still opens.
5. **Keep the browser responsive.** Annotation rendering shares one hidden drawing area, so it stays one page at a time while file downloading continues to run several at once.

## Technical notes

- `pdfPageOverlayExport.ts`: add a single-document in-place mode used by the bulk path — `PDFDocument.load(sourceBytes)`, iterate only specs where `overlays.length > 0 || userRotation`, `drawImage` the overlay PNG onto the existing page using the current CropBox/rotation math, `setRotation` where needed, then `save({ useObjectStreams: false })`. The existing multi-entry `copyPages` merge path stays for any caller that merges files.
- Move the `setTimeout(0)` yield so it counts processed (not total) pages.
- `BulkDrawingDownloadModal.tsx`: in the annotated branch call the new in-place builder with the file's `pages`; build the `pages` array only for pages that have overlays or rotation so the no-op entries never reach the builder. Fast path and file-level concurrency (6) are unchanged.
- Overlay capture (`captureOverlayOnly`) mounts a shared offscreen React root; guard it with a simple mutex so concurrent files cannot interleave captures.
- No schema changes; annotation appearance in the output is unchanged.
