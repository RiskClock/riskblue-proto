

# Draw Red Circles Instead of Bounding Boxes in RawResultModal

## Summary

Replace the rectangular bounding box overlays in the `RawResultModal` with red circles. Each circle is centered on the detected tag's location in the PDF text layer, with a radius derived from the bounding box dimensions plus padding.

## Changes

**File: `src/components/analysis/AnalysisSection.tsx`** — lines 798-816

Replace the rectangle drawing code inside the page-rendering loop with circle drawing:

1. Compute center point from the viewport-converted rectangle coordinates
2. Calculate radius as `max(width, height) / 2 + 20` (same approach used in the other viewer)
3. Draw a red translucent filled circle (`rgba(239, 68, 68, 0.15)`) with a red stroke (`rgba(239, 68, 68, 0.9)`)

```text
Current (rect):
  ctx.fillRect(x, y, w, h)
  ctx.strokeRect(x, y, w, h)

New (circle):
  cx = x + w/2
  cy = y + h/2
  radius = max(w, h) / 2 + 80  (scaled for high-res canvas at scale=4)
  ctx.arc(cx, cy, radius, 0, 2π)
  ctx.fill() + ctx.stroke()
```

No other files affected. The `findBBoxInTextLayer` function and `parseRoomTagsFromResult` remain unchanged — only the rendering step changes from rect to circle.

## Files Changed

| File | Change |
|---|---|
| `src/components/analysis/AnalysisSection.tsx` | Replace `fillRect`/`strokeRect` with `arc` circle drawing in the RawResultModal page render loop (~lines 800-816) |

