
## Investigation findings

### 1. Total page count "ticks up" instead of showing total immediately
**Where:** `src/components/wizard/ProjectFilesUpload.tsx` calls `extractPDFData()` which streams page-by-page progress. There IS already an `onPageCountKnown` callback (line 229) that fires once pdf.js loads the document — but the **upload modal** displays `pageCount` from `pdfMetadata.pageCount` (lines 732, 1060) which is initialized to `0` (line 211) and only set inside the per-page progress callback rather than from `onPageCountKnown`.

**Fix:** Use the `onPageCountKnown` callback to set `pageCount` immediately on PDF open, before the per-page text extraction loop runs. The total will then appear instantly while only the "processed" counter ticks up.

---

### 2. PDF takes long to load when entering the analysis page
**Where:** `useDocumentSource` already has an in-memory LRU blob cache, and `usePdfPageRaster` has a `WeakMap` cache keyed by Blob — but both are populated only when the user **opens** the preview modal. There is no prefetch when the user lands on the analysis page.

**Fix (frontend-only prewarm):** In `AnalysisSection.tsx` (or a new `usePrefetchDrawingPreviews` hook), once the file list loads, kick off background `useDocumentSource`/`usePdfPageRaster` for the first ~3-5 files. Use `requestIdleCallback` so it doesn't block initial render. Subsequent modal opens will hit the cache and feel instant.

Optional: also persist the rasterized first page as a thumbnail data-URL in `sessionStorage` keyed by storage path, so reopening the page doesn't re-download.

---

### 3. "Triaging Drawings 12 drawings" with 1 file
**Where:** `src/components/analysis/AnalysisSection.tsx` line 3582-3596:
```ts
case "triaging":  return "drawings";
```
But the actual counter (`pipeline_progress_total`) set at line 1321 of `run-analysis-pipeline/index.ts` is **`triageJobRows.length`**, which equals `pages × enabled-classes` (one triage job per page per class). For a 12-page PDF with 1 enabled class that's 12; with 4 classes it's 48.

**The label is wrong, not the count.** "12 drawings" should read "12 pages" (or more precisely, "12 triage tasks"). With multiple classes the count is `pages × classes`, so "pages" alone is also incomplete.

**Fix:** Change the triage unit from `"drawings"` to `"pages"` if `enabledClasses.length === 1`, otherwise `"page checks"` (or `"items"`). Cleanest: always say `"page checks"` during triage. Same fix for any other place that says "drawings" while counting per-page-per-class jobs.

---

### 4. Per-cell spinner disappears mid-way during triage
**Where:** Cell spinner (line 4225) is shown only when `triage?.status === "queued" | "pending" | "processing"`. The triage row exists in `analysis_pipeline_jobs`, NOT `analysis_results`. Once a triage job for `(file, class)` completes (or is short-circuit-skipped), the spinner correctly hides — but the cell goes blank if no `analysis_results` row exists yet for that `(file, class)` pair (analyze placeholders aren't inserted until phase 3 starts).

So during the gap between **"this triage job finished"** and **"phase 3 inserts analyze placeholder"**, the cell renders empty. With horizontal short-circuit collapsing remaining triage jobs to `done`, this gap can be quite visible.

**Fix:** While `pipelinePhase ∈ {triaging, dispatching_analyze}`, if the cell has no triage job in flight AND no analyze result yet AND the (file,class) pair is enabled, render a faint spinner / "Queued" placeholder rather than blank. Alternatively, insert analyze placeholders earlier (at phase 2 boundary) — but that's a bigger backend change; keep it frontend.

---

### 5. "Analyzing Content 0/4 classes" in phase 3
**Where:** `run-analysis-pipeline/index.ts` line 1729-1735 sets `pipeline_progress_total = jobRows.length + immediateFailures.length` at the moment phase flips to `analyzing`. `jobRows` is the count of **(file × class) pairs that survived triage**, not classes.

So the total `4` you saw was **4 file-class analyze jobs**, not 4 classes. Unit label `"classes"` (line 3592) is misleading — for a 1-file/4-class run it happens to coincide, but for 4-files/2-classes it would say "0/8 classes" which is wrong.

**Fix:** Change the analyzing unit to `"items"` or `"checks"` (matches the per-cell semantics). Or compute the unit dynamically: if `jobRows.length === enabledClasses.length` and file count is 1, say "classes"; else "checks".

---

## Plan of changes (all frontend, no backend / DB changes)

1. **`src/components/wizard/ProjectFilesUpload.tsx`** — set `pageCount` from the existing `onPageCountKnown` callback so the modal shows the true total immediately.

2. **`src/components/analysis/AnalysisSection.tsx`**:
   - Add a lightweight prefetch effect that warms `useDocumentSource` for the first few files (idle-time).
   - Update `pipelineUnit` (lines 3582-3596): change `triaging → "page checks"` and `analyzing/summarizing → "checks"` (or `"items"`); keep `splitting/extracting → "pages"`.
   - In the per-cell render (around line 4225), add a "queued" fallback spinner when `pipelinePhase ∈ {triaging, dispatching_analyze, analyzing}` and the cell has neither a live triage job nor an analyze result yet.

3. **No backend changes** — counts and totals from the pipeline are correct; the labels in the UI just need to match what's actually being counted.

## Open questions
- Issue 3 wording: prefer **"page checks"**, **"items"**, or split into `pages × classes`? I'll default to **"page checks"** unless you say otherwise.
- Issue 2 prefetch budget: warm **first 3 files** by default (covers the common case without burning bandwidth on 50-file runs). OK?
