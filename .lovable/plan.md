# Pixel-based edge snapping for polygon vertices

## Change

Replace the 5-degree angular tolerance with a 5-pixel distance tolerance when dragging a bbox vertex.

- An edge snaps to horizontal when the dragged vertex is within 5 screen pixels vertically of that neighbor.
- An edge snaps to vertical when it is within 5 screen pixels horizontally of that neighbor.
- Both can apply at once (one axis each); if both neighbors qualify on the same axis, the nearer one wins.

Because the tolerance is measured on the rendered surface, the snap "feel" stays identical at every zoom level and on any page size, unlike the angular rule which snapped from far away on long edges and barely at all on short ones.

## Technical notes

- File: `src/components/viewer/DocumentSurface.tsx`, in `startPolygonDrag`.
- Convert the normalized delta to on-screen pixels using the drag's `surfRect` (`dx * surfRect.width`, `dy * surfRect.height`) and compare against a `SNAP_PX = 5` constant instead of computing `atan2` angles.
- Snapped coordinates remain clamped to 0..1.
