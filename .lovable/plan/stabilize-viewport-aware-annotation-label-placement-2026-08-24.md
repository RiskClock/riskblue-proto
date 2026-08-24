# Stabilize viewport-aware annotation label placement

The current implementation filters placement inputs by the buffered viewport, but the optimizer still constrains candidates to the full page. It also reruns the complete placement pass whenever the debounced viewport key changes. That allows labels to be chosen outside the visible area and gives already-visible labels new positions after a pan.

## 1. Separate visibility, prefetch, and placement bounds

- Keep the density LOD calculation global, using every annotation anchor on the page.
- Use the true visible page rectangle, clipped to the page, as the hard boundary for rendered label pills.
- Keep the existing 20% buffered rectangle only for nearby obstacle collection and prefetching; off-screen anchors will not produce visible labels or long leader lines into the viewport.
- Extend the pure placement input with an optional non-zero-origin bounds rectangle, and clamp every candidate and residual-overlap adjustment to that rectangle rather than to the full page.

## 2. Preserve valid placements while panning

- Maintain a viewer-only placement cache keyed by annotation ID and the current zoom/LOD scale bucket.
- On a pan update, retain each existing label whose complete pill still fits inside the new visible bounds.
- Recalculate only labels that newly enter the viewport or whose previous pill would now be clipped; treat retained labels as fixed obstacles so new labels cannot overlap them.
- Merge new worker results into the cache and render only the currently visible set. This keeps labels stationary in page coordinates during ordinary panning while still repairing labels that would leave the viewport.
- Clear or rebuild the cache when annotations, page dimensions, label visibility, or the zoom/LOD bucket changes, since those changes can alter label size or eligibility.

## 3. Keep existing behavior outside the interactive viewer

- Leave export/synchronous placement on full-page bounds with all labels, unchanged.
- Leave bounding-box labels fixed and excluded from movable label targets, while continuing to include their footprints as obstacles.
- Preserve hovered/selected LOD fallback labels and the global density calculation.

## 4. Validation

- Verify at multiple zoom levels that no annotation pill or leader line is drawn outside the visible drawing viewport.
- Pan in small and large increments and confirm labels that remain fully visible do not move.
- Confirm newly revealed labels are placed without overlapping retained labels, and labels near an exiting edge are repositioned only when necessary.
- Confirm dense-anchor LOD remains based on all page anchors and exported drawings retain full-page label placement.

## Technical notes

- `src/components/viewer/overlayPlacement.ts`: add optional placement bounds plus fixed label obstacles; update candidate clamping and residual separation to honor bounds with non-zero `x/y` origins.
- `src/components/viewer/OverlayLayer.tsx`: derive clipped visible bounds separately from the buffered obstacle cull rect, retain valid prior placements, request only missing/invalid labels, and merge worker results without replacing stable labels.
- `src/components/viewer/DrawingViewer.tsx`: continue using the debounced transform rectangle, but ensure page/rotation changes reset stale viewport placement state.
- Add focused placement tests for viewport clamping and retained-label obstacle avoidance where the existing test structure supports them.