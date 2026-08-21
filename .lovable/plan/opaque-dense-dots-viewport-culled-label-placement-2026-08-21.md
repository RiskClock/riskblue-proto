# Opaque dense dots + viewport-culled label placement

Two viewer-only changes in the drawing canvas. Exports (the synchronous placement path) stay exactly as they are today.

## 1. Dense anchor dots render fully opaque

Annotation anchors whose label was suppressed by the density LOD get a solid fill instead of the current translucent one, so clusters read as distinct dots rather than a smeared blob when zoomed out.

- Only applies to LOD-suppressed anchors. Anchors that have no label, are hidden by the labels toggle, or are hovered/selected keep their current styling.
- The circle outline and hit area are unchanged; only fill alpha goes to 1.

## 2. Viewport culling for placement, with debounced recalculation

Today `runPlacement` sees every annotation and every obstacle on the page, so when zoomed in, labels dodge obstacles the user cannot see and end up in odd positions.

- The viewer computes the currently visible region of the page in normalized document coordinates, expanded by a 20% buffer on each axis so labels don't pop in at the screen edge.
- Before placement runs, both targets (labeled circles, labeled rects) and obstacles (all circles, rect footprints) are filtered to those intersecting the buffered viewport. Anything outside is not placed and not treated as an obstacle.
- The LOD density pass keeps using every anchor on the page (not the culled set), so anchors near the viewport edge still see off-screen neighbours and labels don't pop in incorrectly. Culling applies only to what is fed into placement.
- The visible-region value used by these passes is updated on a 150ms debounce, so panning and zooming recalculate once the gesture settles rather than every frame.
- When the viewport rect is unavailable (export capture, stacked-page layout, first paint before measurement), culling is skipped and behavior falls back to today's full-page placement.

## Technical notes

- `src/components/viewer/DrawingViewer.tsx`
  - Add a `debouncedVisibleRect` state, updated from a 150ms-debounced callback fed by `onTransform` plus the existing settle handlers, reusing the same math as the existing `getVisibleRect` API (`-positionX / (scale * pageWidth)` etc.). Clear the timer on unmount.
  - Pass it as `viewportRect` to the single-page `DocumentSurface`. Stacked-page layout passes nothing.
- `src/components/viewer/DocumentSurface.tsx`: add a pass-through `viewportRect?: { nx; ny; nw; nh } | null` prop forwarded to `OverlayLayer`.
- `src/components/viewer/OverlayLayer.tsx`
  - New constants next to the LOD block: `VIEWPORT_BUFFER_RATIO = 0.2`.
  - New prop `viewportRect`. Derive a page-pixel cull rect (normalized rect times `pageSize`, inflated by the buffer); memoize on the rect's rounded values so tiny jitter doesn't retrigger.
  - Leave the `lodHiddenIds` density memo as-is: the anchor rbush is still built from all labeled circles on the page. Compute `visibleCircleIds` / culled `rectObstacles` separately and feed only those into `buildPlacementInput`, and add the cull-rect key to the async placement effect deps. The sync/export path ignores `viewportRect`.
  - Circles outside the cull rect are excluded from placement input entirely (their dots still render; only labels are affected).
  - Pass a `denseOpaque` flag into `CircleOverlay` for LOD-suppressed anchors and use `withAlpha(color, 1)` for its fill.
