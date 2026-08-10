# Fix polygon vertex snapping: axis-aligned edges, not right-angle corners

## Problem

The current snap in the bbox vertex editor measures the angle between the two edges meeting at the dragged corner, and if it is within 5 degrees of 90 it re-projects the vertex to force an exact right angle. That moves the vertex along an arbitrary diagonal and feels unpredictable, and it can still leave both edges slanted.

## New behavior

While dragging a vertex, evaluate each of its two edges (to the previous and to the next vertex) independently:

- If an edge is within 5 degrees of horizontal, snap the dragged vertex's Y to that neighbor's Y (edge becomes perfectly horizontal).
- If an edge is within 5 degrees of vertical, snap the dragged vertex's X to that neighbor's X (edge becomes perfectly vertical).
- Both edges can snap at once (one on X, one on Y), which naturally produces a clean 90-degree corner when appropriate, but without forcing one.
- If both edges want to snap the same axis, the closer-to-axis one wins.

Shift-drag keeps its existing behavior (hard align to the nearest neighbor on one axis).

Edge dragging (moving a whole side) is unchanged.

## Technical notes

- File: `src/components/viewer/DocumentSurface.tsx`, inside `startPolygonDrag`.
- Replace the right-angle projection block with a per-edge axis test computed in page pixels (`pageSize.width/height`) so page aspect ratio does not distort the angle: an edge is "near horizontal" when `abs(atan2(dy, dx))` is within 5 degrees of 0/180, and "near vertical" when within 5 degrees of 90.
- Apply snaps after clamping, then re-clamp to 0..1.
