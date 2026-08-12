# Fix clipped and overlapping labels in the exported Threat Report

## What's actually wrong

The collision/placement optimizer is the same code in both the modal and the export — that is not the difference. The difference is in the final rasterizer step that only the export runs.

In the export, overlays are rendered offscreen (`overlayOnlyCapture`) and then painted onto a canvas by reading the placed DOM (`rasterizeViewerSurface`). Two mismatches there:

1. **Font size mismatch.** Each label pill carries `data-font-px = 13 x exportScale` (19.5px) — the optimizer's MAX reservation font — but the DOM pill is actually laid out at the zoom-interpolated minimum (8 x 1.5 = 12px), because the offscreen layer renders at zoom 1. The canvas then paints 19.5px text into a box measured for 12px text.
   - Vertically: the rasterizer stacks lines at `fontPx x 1.15` (~22px per line) inside an offscreen canvas whose height is the DOM pill height (~15px per line). With one line it just fits; with several instances stacked the lower lines fall outside the canvas and get clipped — exactly the cut-off boxes in the screenshots.
   - Horizontally: a safety net widens the pill when canvas-measured text is wider than the DOM pill. At 19.5px vs 12px it is always wider, so every multi-instance pill is inflated well past the footprint the optimizer reserved, which is what makes neighbouring pills overlap.

2. **Line-height mismatch.** The DOM uses `round(font x 1.25)` line-height; the rasterizer hardcodes `font x 1.15`, so even at matching font sizes the multi-line block does not land where the pill was sized for.

## The fix

Make the offscreen export render labels at the same size the optimizer reserved, and make the rasterizer trust the DOM instead of an attribute.

- Add an export-only "full size labels" mode to `OverlayLayer`: when rendering for capture, skip the zoom interpolation and render placed labels (and docked bbox labels) at `LABEL_FONT_PX x exportScale` with the matching padding. Pill size then equals the optimizer's reserved rect, so overlaps cannot occur and exported label size stays the same as today.
- Multi-line pill height in that mode is `lines x lineHeight + padding`, matching `heightFor()` in `overlayPlacement.ts` so tall pills reserve the space they occupy.
- In `rasterizeViewerSurface`, read the actual rendered `fontSize`, `lineHeight`, and padding from `getComputedStyle` on the label element instead of `data-font-px`, use that line-height for multi-line stacking, and drop the "grow the pill wider than the DOM" safety net (with matched fonts it only causes overlap). If measured text still exceeds the pill, shrink the drawn font marginally rather than growing the box.
- Keep `data-font-px` in sync with the rendered font as a fallback for anything that still reads it.

## Scope

Affects both export paths that use the shared rasterizer:
- Threat Report DOCX page images
- Annotated PDF download (per-page and bulk), which stamps the same overlay PNG

No change to the on-screen viewer/modal behaviour, no database or backend change.

## Technical touch points

- `src/components/viewer/OverlayLayer.tsx` — new `fullSizeLabels` (export) mode for placed labels and `RectOverlay` docked labels; `data-font-px` reflects rendered font.
- `src/lib/overlayOnlyCapture.ts` — pass the new flag when mounting for capture.
- `src/lib/threatReportPageCapture.ts` — computed-style-driven label painting; remove width inflation; use DOM line-height.
- Verify against a level page with 6-7 stacked instances (the L01/L02 pages in the screenshots) by exporting and comparing to the modal.
