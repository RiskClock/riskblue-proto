

# Google Maps-Style Navigation + Zoom-Out Floor for Drawing Viewers

## Summary

Add scroll-to-zoom, double-click-to-zoom, pinch-to-zoom, click-drag-to-pan, and enforce a minimum zoom of 1.0 (fit-to-container) across all drawing viewer components.

## Interactions

| Gesture | Behavior |
|---|---|
| Scroll wheel | Zoom in/out centered on cursor |
| Double-click | Zoom in 0.5x centered on click |
| Click + drag | Pan (grab/grabbing cursor) |
| Pinch (trackpad/touch) | Zoom centered on midpoint |
| Zoom out limit | Clamped at 1.0 (document fills container) |

## Implementation

### Shared approach (all three viewers)

Add to each scrollable container div: `onWheel`, `onDoubleClick`, `onMouseDown/Move/Up/Leave`, `onTouchStart/Move/End`.

- **dragRef** (`useRef`) tracks `isDragging`, `startX`, `startY`, `scrollLeft`, `scrollTop` — no re-renders during drag.
- **onWheel**: `preventDefault()`, detect `ctrlKey` for trackpad pinch. Compute cursor fraction of content, apply ±0.25 zoom, reposition scroll to keep point stable. Clamp min 1.0, max 8.
- **onDoubleClick**: +0.5 zoom centered on click point, clamped to max.
- **Mouse drag**: Set scroll position based on delta from start.
- **Touch**: Two-finger distance change → zoom delta; single finger → pan.
- All zoom-out paths use `Math.max(1, ...)` instead of current 0.25/0.5.

### File: `src/components/analysis/AnalysisSection.tsx`

**InstanceDetailModal** (~line 612-697):
- Add dragRef, event handlers to container div
- Change `Math.max(0.25, ...)` → `Math.max(1, ...)` in handleZoomOut

**RawResultModal** (~line 848-888):
- Add dragRef, event handlers to pdfScrollRef container
- Change `Math.max(0.25, ...)` → `Math.max(1, ...)` in handleZoom

**FilePreviewModal** (~line 1004-1017):
- Add dragRef, event handlers to container div
- Change `Math.max(0.25, ...)` → `Math.max(1, ...)` in handleZoomOut
- Update zoom-out button disabled check to `zoom <= 1`

### File: `src/components/wizard/FileViewerModal.tsx`

- Add dragRef, event handlers to container div (~line 259)
- Change `Math.max(0.5, ...)` → `Math.max(1, ...)` in handleZoomOut

## Files Changed

| File | Change |
|---|---|
| `src/components/analysis/AnalysisSection.tsx` | Add map-style nav handlers + zoom floor of 1.0 to InstanceDetailModal, RawResultModal, FilePreviewModal |
| `src/components/wizard/FileViewerModal.tsx` | Add map-style nav handlers + zoom floor of 1.0 |

