

# Fix File Name Column Width, Add Bounding Boxes to RawResultModal, Unify Zoom

## 1. File Name column: content-hugging width

**File: `src/components/analysis/AnalysisSection.tsx`**

Replace the fixed `min-w-[320px]` on the sticky file name column with a content-hugging approach:
- Set `min-w-[180px] max-w-[320px] w-auto` on all three sticky `<th>`/`<td>` elements (header, sub-header, body rows)
- The column will shrink to fit the longest file name but never exceed 320px or go below 180px
- Keep the `truncate` on the file name text with `max-w-[300px]`

## 2. Bounding boxes in RawResultModal

The `RawResultModal` currently renders the PDF as raw canvases with no detection overlays. Refactor it to:

- After loading the PDF, call `findBBoxInTextLayer()` (already defined in the same file) for each room tag parsed from `resultText` using `parseRoomTagsFromResult()`
- Store all found bboxes as an array of `PDFBBox` objects
- When drawing canvases, overlay red translucent rectangles for each bbox on the appropriate page canvas (same style as InstanceDetailModal: `rgba(239, 68, 68, 0.15)` fill, `rgba(239, 68, 68, 0.9)` stroke)
- This requires keeping the `pdfViewport` per page to do coordinate conversion via `convertToViewportRectangle`

The approach: instead of rendering canvases at scale 2 and appending them raw, render at scale 4 (matching InstanceDetailModal), draw bboxes directly onto each canvas after rendering, then append them.

## 3. Unified zoom logic

Currently there are 4 separate zoom implementations with different max/min/step values:
- `LocationDetailsModal`: max 3, step 0.25
- `InstanceDetailModal`: max 4, step 0.25
- `RawResultModal`: max 4, step 0.25
- `FilePreviewModal`: max 4, step 0.25

Standardize all to: **min 0.25, max 8, step 0.25** with center-preserving scroll. The `InstanceDetailModal` already has the best implementation (center-preserving with `requestAnimationFrame`). Apply the same pattern to `RawResultModal`, `FilePreviewModal`, and `LocationDetailsModal` (which currently caps at 3x).

## Files Changed

| File | Change |
|---|---|
| `src/components/analysis/AnalysisSection.tsx` | File name column width (3 elements), RawResultModal bounding boxes, unified zoom constants across RawResultModal/FilePreviewModal/InstanceDetailModal |
| `src/components/wizard/LocationDetailsModal.tsx` | Increase max zoom from 3 to 8 |

