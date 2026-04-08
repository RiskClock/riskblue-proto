

# Make Analysis Summary Manual with Summarize Button

## Summary

Remove all automatic calls to `handleSummarize` that fire after analysis completion. Add a "Summarize Analysis Results" button next to the section title. Replace the `ScanLine` icon with `FileText` (document icon). Support stop and re-run behavior.

## Changes

**File: `src/components/analysis/AnalysisSection.tsx`**

### 1. Add state for summary run
- Add `summaryRunning` boolean state to track if summarization is in progress
- Add `summaryAbortRef` ref to support cancellation

### 2. Remove automatic summarization calls
Remove `handleSummarize` calls from these locations:
- Line ~1980: after V1 analysis completion
- Line ~2278: after single-class analysis completion  
- Line ~2516: after V2 scheduler finds all complete on mount
- Line ~2716: after V2 scheduler completion

### 3. Add "Summarize Analysis Results" button handler
- `handleSummarizeAll`: iterates through `sortedPrompts` sequentially, calling `handleSummarize` for each AWP class that has analysis results
- Before starting, clears existing `summarizedInstances` and `addedToProject` state
- Checks abort ref between each class to support stopping
- Sets `summaryRunning` to true/false appropriately

### 4. Update the summary section header
- Replace `ScanLine` icon with `FileText` (document icon) — already imported or add import
- Add "Summarize Analysis Results" button next to the title
- When running, button text changes to "Stop" with a stop icon
- Clicking "Stop" sets abort ref, which halts the sequential loop
- Clicking again clears results and restarts

### 5. Icon
- Import `FileText` from lucide-react (if not already imported)
- Replace `<ScanLine>` on line 3851 with `<FileText>`

## Technical details

```text
Current flow:
  analysis completes → auto-calls handleSummarize for each class

New flow:
  analysis completes → no auto-summarize
  user clicks "Summarize Analysis Results" → clears old data → runs handleSummarize sequentially
  user clicks "Stop" → sets abort flag → loop exits early
  user clicks button again → clears results → restarts
```

The existing `handleSummarize` function stays as-is — it handles a single AWP class. The new `handleSummarizeAll` orchestrates calling it for each class.

## Files to update

| File | Change |
|---|---|
| `src/components/analysis/AnalysisSection.tsx` | Remove 4 auto-summarize call sites, add summarize button + handler + stop support, swap icon to FileText |

