# Enhance Analysis Result Modal with Drawing Viewer + Make "0" Cells Clickable

## Overview

Two changes to the Drawing Analysis grid:

1. **Upgrade the RawResultModal** to show the source PDF drawing on the right side (with zoom/pan), alongside the AI response text on the left. This reuses the same PDF rendering pattern already used in `InstanceDetailModal` and `FilePreviewModal`.
2. **Make "0" detection cells clickable** so users can read the AI's reasoning for why no instances were found on a given sheet.

## Changes

### File: `src/components/analysis/AnalysisSection.tsx`

**A. Redesign `RawResultModal` (lines 706-730)**

- Change the layout from a simple text-only dialog to a split-panel layout similar to `InstanceDetailModal`:
  - **Right panel (~40%)**: Scrollable area showing the file name, AWP class, instance count, and the full AI response text in a `<pre>` block.
  - **Left panel (~60%)**: PDF drawing viewer with zoom in/out controls, loaded from `drive-analysis-files` storage using the file's `storage_path`.
- Add `sourceFile: AnalysisFile | undefined` to the `RawResultModalProps` interface so the modal knows which file to load.
- Reuse the same PDF download + render pattern from `InstanceDetailModal` (download blob from storage, render with pdf.js at scale 2, display in a scrollable container with center-preserving zoom).
- The dialog size changes to `sm:max-w-5xl h-[85vh]` to accommodate the split layout.

**B. Update `RawResultModal` invocation (lines 988-993, 1618-1628)**

- Add `sourceFile` to the `rawResultModal` state type.
- When opening the modal (the `onClick` handler at line 1618), also pass the corresponding `AnalysisFile` object.

**C. Make "0" cells clickable (lines 1635-1641)**

- Replace the plain `0` text with a clickable `<button>` (same style as the `> 0` cells but in muted color).
- On click, find the result for that file+class combination and open `RawResultModal` with the result text and source file.
- This lets users read the AI reasoning for why zero instances were detected.

## Technical Details

The PDF viewer in the redesigned `RawResultModal` will:

- Download the PDF blob from `supabase.storage.from("drive-analysis-files").download(storagePath)`
- Render all pages (up to 20) at scale 2 using pdf.js
- Display in a scrollable container with `transform: scale(zoom)` and center-preserving zoom handlers
- Show a loading spinner while the PDF loads
- Gracefully handle missing `storage_path` with a "Drawing not available" message

No new components are created -- all changes are within the existing `AnalysisSection.tsx` file, following the established patterns.