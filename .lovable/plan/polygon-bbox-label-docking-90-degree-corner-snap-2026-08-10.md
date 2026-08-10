# Polygon bbox label docking + 90-degree corner snap

## 1. Dock labels to the shape, not the envelope corner

Today a bbox label is always drawn at the top-left of the shape's rectangular envelope. For L-shaped / notched polygons whose top-left corner is folded inward, the label floats in empty space away from the outline (visible with "Suite G" and "Suite H - GF").

New behaviour for polygon bboxes:

- Find the longest near-horizontal edge in the upper portion of the polygon (the "top edge").
- Dock the label at the left end of that edge, sitting on the border exactly like the current header-tab styling.
- Plain rectangles keep the existing top-left docking (identical result, no visual change).
- The docked anchor is exported too, so downloaded PDFs / threat-report captures place labels the same way as the on-screen viewer.

## 2. Snap corners to 90 degrees

While dragging a polygon vertex, if the angle it forms with its two neighbouring vertices is within 5 degrees of a right angle, the vertex snaps so the corner becomes exactly 90 degrees. Shift-snapping to a neighbour's horizontal/vertical line stays as it is today and takes priority when Shift is held.

## Technical notes

- `src/components/viewer/OverlayLayer.tsx`
  - Add a helper that computes the label anchor from `r.pts`: consider each edge, score by horizontal length with a slope tolerance (e.g. `|dy| <= 0.35 * |dx|`), prefer edges nearer the polygon's min-y; choose the longest qualifying edge and take its left-hand endpoint. Fall back to the topmost vertex, then to `(0,0)`, when no edge qualifies.
  - Use that anchor for the label div's `left`/`top` and for the `data-x` / `data-y` attributes consumed by export.
  - Feed the same anchor into the label-reservation rectangle used by the circle-label placement optimizer so annotation labels keep avoiding bbox labels.
- `src/components/viewer/DocumentSurface.tsx` (`startPolygonDrag`)
  - After computing the dragged vertex position, when `ev.shiftKey` is false, measure the angle at the dragged vertex between its previous and next neighbours (in page-pixel space so aspect ratio is respected). If it is within 5 degrees of 90, project the dragged point onto the exact right-angle position: keep its distance along one neighbour direction and place it so the two edge vectors are perpendicular.
  - Only affects the live drag path; envelope recomputation and persistence are unchanged.
