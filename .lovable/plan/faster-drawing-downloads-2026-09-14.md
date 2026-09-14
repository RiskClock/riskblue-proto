# Faster drawing downloads

## Why it is slow today

The British Library project has 162 drawings totalling about 105 MB. Today the download window handles them strictly one at a time: fetch a file, rebuild it, then move to the next. Nothing overlaps, so the wait is roughly the sum of 162 separate downloads plus 162 rebuilds. Size matters, but the bigger cost is doing everything in single file.

Page numbers appear as you wait because the current window only learns a file's page count after it has finished downloading that file. The page count is in fact already stored for every one of the 162 files, so it can be shown before you press the button.

## What changes

1. **Show the totals upfront.** As soon as the window opens, each file lists its page count from stored data, and a summary line shows selected files, total pages, and total size. No waiting.

2. **Download several files at once.** Files are fetched in parallel (a handful at a time) instead of one by one. This is the single largest speed win.

3. **Skip rebuilding untouched files.** If a file has no annotations to stamp (or annotations are switched off), its original PDF goes straight into the ZIP instead of being taken apart and re-saved page by page. In this project no annotations exist at all, so every file takes the fast path.

4. **Build the ZIP without re-compressing.** PDFs are already compressed, so the ZIP is assembled in store mode: faster, with essentially the same file size.

5. **Real progress.** The progress line reports files completed out of total (and pages when annotations are being stamped), rather than a page counter that only appears late.

6. **Large-selection warning.** If a selection exceeds roughly 25 MB or 25 files, the window shows a short note that the download will take a while and to keep the tab open. Nothing is blocked.

## Not included

No background server job and no email delivery, per your choice to keep downloads immediate in the browser. If very large projects still feel slow after this, that remains the next step.

## Technical notes

- `BulkDrawingDownloadModal.tsx`: seed `pageCounts` from `analysis_request_files.expected_page_count` (already populated for all 162 rows) when the modal opens; add selected files/pages/size summary; replace the sequential `for` loop over `chosen` with a bounded-concurrency worker pool (limit 6) for `resolveDocumentSource` + build; progress switches to files-done/total with page-level detail only when overlays are stamped.
- Fast path: when `includeOverlays` is false, or the file has no circle overlays and no `extraOverlaysByFilePage` entries and no non-zero `page_rotations`, push the raw fetched bytes into the ZIP and skip `buildAnnotatedPdf` entirely.
- `zip.generateAsync({ type: "blob", compression: "STORE" })`.
- `pdfPageOverlayExport.ts`: drop the unconditional `setTimeout(0)` yield per page; yield every 5 pages instead, since the overlay path is the only one that needs it now.
- No schema changes; annotation rendering output is unchanged.
