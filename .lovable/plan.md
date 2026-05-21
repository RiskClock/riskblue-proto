## Confirmation of the bug

Yes — highlights are positioned by text-layer matching, and the current matcher returns the **first** occurrence only.

- `src/lib/pdfTextLayerSearch.ts` → `findBBoxInTextLayer(pdf, tag, hintPage)` walks pages, breaks on the first item whose normalized text equals the tag (Pass 1), or first cross-item concat that matches (Pass 2), or longest substring (Pass 2.5). It returns a single `PDFBBox` and never looks for further occurrences.
- Callers that hit this:
  - `AnalysisSection.tsx` line 417 — single-instance overlay opener
  - `AnalysisSection.tsx` line 654 — Raw Result modal loop over all rows
  - `analysisDocxExporter.ts` line 452 — DOCX export
  - `LocationDetailsModal.tsx` line 186 — wizard location pinning

When the AI returns multiple detection rows on the same page with identical candidate text (e.g. two rooms tagged `EL-01`, or two pipes labelled `CWS-50`), every row resolves to the same first bbox.

## Fix

Teach the matcher to enumerate occurrences, and have each caller request the right one based on its ordinal among same-text siblings.

### 1. `src/lib/pdfTextLayerSearch.ts`

- Refactor the per-page scan into an internal helper that returns **all matches on a page** in document order (Pass 1 + Pass 2; Pass 2.5 substring stays as a last-resort fallback only when no exact matches exist).
- Public API change: add an optional `occurrenceIndex?: number` (default 0) to `findBBoxInTextLayer`. The function:
  - Visits pages in the same order (hint page first, then 1..N).
  - Collects exact matches per page.
  - Returns the `occurrenceIndex`-th exact match overall. If fewer exact matches than `occurrenceIndex`, fall back to the last exact match (preferred over substring) and log a warning.
  - If no exact matches anywhere, fall through to the existing substring fallback.
- Pass 3 (room-name expansion) runs on the chosen matched item, unchanged.
- Keep current signature backwards-compatible (callers that don't pass `occurrenceIndex` still get the first match).

### 2. `src/components/analysis/AnalysisSection.tsx`

**Single-instance opener (≈ line 383–460):**
- After `parseOverlayCandidates(resultText)`, compute the instance's ordinal among rows that resolve to the same candidate text on the same page:
  - For each row, derive a key from `(pageNum, normalizeText(primary candidate))`.
  - The instance's `occurrenceIndex` = position of its row within rows sharing that key.
- Pass `occurrenceIndex` to `findBBoxInTextLayer`.

**Raw Result modal loop (≈ line 622–672):**
- Track a `Map<pageKey, count>` keyed by `(pageNum, normalizeText(candidate))`.
- Before each `findBBoxInTextLayer` call, look up the current count for the key, pass it as `occurrenceIndex`, then increment.
- Only count successful exact matches so failed candidates don't poison the counter.

### 3. `src/lib/analysisDocxExporter.ts`

- Mirror the single-instance opener change: compute occurrence index by scanning `rows` for same-(page, normalized text) siblings before the current instance's row, pass into `findBBoxInTextLayer`.

### 4. `src/components/wizard/LocationDetailsModal.tsx`

- Lower priority: this modal resolves a single user-selected location at a time, so duplicate-text ambiguity is less likely. Leave the call as `occurrenceIndex=0` (default) unless we can derive an ordinal here too — to be confirmed when reading the file. No behaviour regression either way.

## Out of scope

- AI-supplied pixel bboxes (`aiBBox`) — those already carry exact coordinates and skip text matching entirely.
- Changing the AI prompt to disambiguate identical labels.
- Reworking Pass 3 room-name expansion.

## Verification

- A drawing with two rooms sharing the same tag on one page: each row's "View" button highlights a different location.
- Raw Result modal on the same page shows two distinct boxes instead of one stacked box.
- A drawing with a unique tag still resolves identically (no regression).
- DOCX export embeds two distinct crops for duplicate-text instances.
