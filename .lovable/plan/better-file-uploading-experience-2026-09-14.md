# Better file uploading experience

Today, adding files uploads them strictly one at a time, shows nothing until the whole batch finishes, and locks the window. With 162 files that means a long wait staring at "Uploading 20/162…" and an empty table.

## What changes

**1. Upload several files at once**
Files upload in parallel (6 at a time) instead of one after another. Large batches finish several times faster.

**2. The table fills in as files land**
Each file appears in the list the moment it's stored, instead of everything showing up at the end. No more "No files in this project yet" while an upload is clearly running.

**3. A real progress bar**
Replace the plain "Uploading 20/162…" text with a progress bar showing files done, total, and the name of what's currently uploading.

**4. Per-file status instead of one lump result**
Each row shows uploading / done / failed. Failures stay visible in the list with a Retry action, rather than only being counted in a toast.

**5. Cancel mid-upload**
A Cancel button stops the remaining queue. Already-uploaded files stay; nothing is half-committed.

**6. Drag and drop**
Drop files (or a folder) anywhere on the window to add them, with a highlighted drop zone. Folder drops keep nested PDFs.

**7. Friendlier guardrails**
- Reject unsupported types up front with a clear message naming the file, rather than failing silently mid-batch.
- Warn when a file with the same name already exists, since it currently overwrites without asking.
- Allow closing the window while uploading; the upload keeps running and progress is shown on the Manage Files button.

## Technical notes

All in `src/components/workbench/ManageFilesModal.tsx`:
- Replace the sequential `for` loop in `handleAddFiles` with a bounded worker pool (concurrency 6) over the picked files, each worker doing storage upload + `analysis_request_files` insert.
- Move `extractPdfPageCount` off the critical path: insert the row first, then patch `expected_page_count` after, so page parsing never delays the upload.
- Track per-file state in a `Map<string, {status, error}>` keyed by a client-side id; merge these optimistic rows into the rendered table above the persisted `files` prop.
- Call `onChanged()` on a throttled basis (e.g. every ~1s) during the batch so persisted rows stream in, plus once at the end alongside `syncRequestTotals`.
- Use an `AbortController` (checked between queue items; passed where supported) for Cancel.
- Add `onDragOver`/`onDrop` on `DialogContent` with `webkitGetAsEntry` traversal for folder drops; filter by `ACCEPTED_TYPES`.
- Duplicate-name check against the current `files` list before uploading; `upsert: true` stays but only after confirmation.
- Lift upload state out of the modal (or keep it mounted) so closing the dialog doesn't abort the batch.
