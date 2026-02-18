
# Analysis Detail Page — 5 UI Improvements

## Overview of Changes

All changes are in two files:
- `src/pages/AnalysisRequestDetail.tsx` — Files section collapsible
- `src/components/analysis/AnalysisSection.tsx` — Progress fix, Display ID rename, live per-file analysis animation, hide raw data

---

## 1. Files Section — Collapsible, Collapsed by Default

In `AnalysisRequestDetail.tsx`, the Files card header becomes a toggle button. A `filesCollapsed` state defaults to `true`. When collapsed, the table body is hidden; the header shows a `ChevronRight` / `ChevronDown` icon alongside the existing metadata line. The Download ZIP button remains visible in the header at all times.

---

## 2. Rename "ID" → "Display ID" in the Analysis Results Table

In `AnalysisSection.tsx`, two `<TableHead>` cells labelled `ID` are renamed to `Display ID`:
- The summarized instances table header (line 623)
- The raw parsed instances table header (line 662)

No logic changes — purely a label change.

---

## 3. Fix Overall Progress Percentage

**Current bug**: `progress.current` is incremented at the start of processing each file (before the API call), so when the last file starts, progress reads 100%.

**Fix**: Increment `progress.current` only after a file finishes (success or failure), not before. The progress state will be updated at the end of each file loop iteration instead of the beginning. This means progress goes from 0% → …% → 100% only when the last file genuinely completes.

Specifically, in `handleAnalyze`:
- Remove `setProgress({ current: i + 1, total: copiedFiles.length })` from the top of the loop
- Move it to after the try/catch block (after `setFileStatuses` is set to complete/failed)

---

## 4. Per-File Analysis Animation (Replaces the Badge Chip List)

**Current**: Files shown as small badge chips in a wrapped `flex` row. No detail, no per-file progress.

**New design** (inspired by the screenshot reference — list of files with inline status):

Replace the badge-chip block with a vertical list of file rows, each showing:

```
[ icon ] filename.pdf                 [ status badge ]
         [ progress bar — only visible when processing ]
         Detected: Electrical Room EL-B01 on Level P1...  ← simulated detection message
```

**Per-file states:**
- `pending` — muted, no bar
- `processing` — animated spinner icon, progress bar (animated indeterminate pulse), rotating detection message drawn from prompt keywords
- `complete` — green check, "Complete" badge
- `failed` — red X, "Failed" badge

**Detection message simulation**: When a file is `processing`, a rotating message cycles every ~1.5s from a set of plausible strings generated from the AWP class name. For example, for "Electrical Room":
```
"Scanning for electrical room labels..."
"Detected panel room reference on drawing..."
"Identifying room boundaries..."
"Cross-referencing floor annotations..."
"Extracting room codes from title block..."
```

These messages are statically defined per category (Asset / Water System / Process) and parameterized with the class name — no AI call needed, purely cosmetic simulation.

A small `useEffect` inside the rendering block cycles through the messages array using `setInterval` whenever the file status is `processing`.

**Implementation approach**: Extract a new `FileAnalysisRow` sub-component inside `AnalysisSection.tsx` to keep the JSX clean. It receives `fileName`, `status`, `awpClassName`, and renders the row with internal cycling state.

---

## 5. Hide Raw Data — Only Show Summarized Results

**Current**: After analysis, the raw parsed table (`allInstances`) shows immediately, and raw fallback text is also shown with an expand toggle. The summarized table appears separately above it only after the "Summarize" step.

**New behavior**:
- The raw parsed instances table (`allInstances`) is **removed entirely** from the rendered output
- The raw fallback text block (unparseable results) is also **removed**
- The summarized instances table (already shown post-summarization) is the **only** result display
- Summarization is already triggered automatically after analysis completes (`handleSummarize` is called in `finally` block) — this behaviour is unchanged
- While summarizing, the existing "Summarizing..." spinner in the header is sufficient feedback
- If summarization yields 0 instances, the "No unique instances found" message already handles this

This means the manual "Summarize" button (shown when `hasResults && !isAnalyzing && !summary`) should remain for the re-run case, but the raw table below it is gone.

---

## File Changes Summary

| File | Changes |
|---|---|
| `src/pages/AnalysisRequestDetail.tsx` | Add `filesCollapsed` state (default `true`); wrap table body in conditional; add collapse toggle to header |
| `src/components/analysis/AnalysisSection.tsx` | Fix progress increment timing; rename ID → Display ID; replace badge chip list with `FileAnalysisRow` per-file list with cycling detection messages; remove raw data blocks |

No backend changes. No new dependencies.

---

## Technical Notes

- The `FileAnalysisRow` sub-component uses `useEffect` + `useState` for the cycling detection message. The interval only runs when `status === "processing"`. The interval is cleared on unmount or when status changes.
- Detection messages are defined as a `Record<string, string[]>` keyed by category (`"Asset"`, `"Water System"`, `"Process"`) with a generic fallback array. The AWP class name is interpolated into the message strings at render time.
- The per-file indeterminate progress bar uses a CSS animation (`animate-pulse` on a full-width bar) rather than a real value — since we have no sub-file progress signal from the API, a pulsing bar is honest and visually clear.
- Progress fix: `setProgress({ current: i + 1, total })` moves from line 302 (top of loop) to after the inner try/catch block (after line 333), ensuring it only fires once the file is done.
