# Irregular (polygon) bounding boxes

## Context correction

This project does not use Fabric.js, and there is no `src/types/threatReport.ts` / `src/types/spatial.ts`. Bounding boxes are custom DOM/SVG overlays:

- Geometry lives as normalized rects `{ nx, ny, nw, nh }` (`src/components/viewer/viewerGeometry.ts`).
- Boxes are drawn by `OverlayLayer.tsx` (SVG `<rect>` + label placement) and edited by the handle editor in `DocumentSurface.tsx`.
- Persistence is `analysis_request_sheets.floor_plan_overrides[plan_id]` (jsonb) plus the Scout-parsed `xy_width_height_pct` in `src/lib/surveyFloorPlans.ts`.

So the same UX is built natively against these pieces instead of Fabric. No database migration is needed - the polygon lives inside the existing jsonb override.

## What you get

All four bbox types (level floor plan, schematic level row, unit floor plan, typical detail block) can become irregular polygons.

- Selecting a bbox shows a draggable handle on every vertex plus a faint ghost node at the midpoint of every edge.
- Clicking a ghost node inserts a vertex there and splits the edge; dragging it out turns a rectangle into an L-shape (or anything else).
- Clicking an existing vertex (without moving more than 5px, matching the viewer's existing drag threshold) deletes it. Deletion is blocked at 3 vertices.
- Holding Shift while dragging a vertex snaps it to horizontal/vertical alignment with its neighbours so wall lines stay straight.
- Dragging the box body still moves the whole shape; the outer resize handles keep working and scale every vertex proportionally.
- Annotation attribution becomes true point-in-polygon: markers count for a level/unit only when they sit inside the actual shape, not the rectangular envelope. Marker drag-clamping also respects the polygon.
- The polygon renders everywhere the box does today: drawing modal, badges/fit-to-selection, threat report pages, and PDF/PNG exports.

## Compatibility

Existing rectangles keep working untouched - a box with no `points` behaves exactly as today. The first time a rectangle is edited it is seeded with its 4 corners. The rectangular envelope (`nx, ny, nw, nh`) is always recomputed and stored alongside the points, so anything not yet polygon-aware (sorting, label docking, zoom fitting) keeps functioning.

## Technical

**Geometry model** (`viewerGeometry.ts`)
- Add `NormalizedPoint { nx, ny }` and extend the normalized rect with optional `points?: NormalizedPoint[]`.
- Helpers: `envelopeOf(points)`, `rectToPoints(rect)`, `pointInPolygon(pt, points)` (ray casting), `rotatePolygon(points, rotation)` mirroring the existing `rotateRect`/`rotatePoint` (all four rotations, same `qc`/`q6` quantization).

**Persistence** (`floor_plan_overrides[plan_id]`)
- New sibling key `points: [[x,y], ...]` in page-percent units (0..100), matching `xy_width_height_pct`'s convention so Scout output and overrides stay one unit system.
- `xy_width_height_pct` is rewritten from the envelope on every save, keeping backward compatibility and the existing audit trigger (`audit_floor_plan_overrides`) meaningful.
- `surveyFloorPlans.ts`: parse an optional `points` array on each plan, expose `points: [number, number][] | null` on `ParsedFloorPlan`.

**Rendering** (`OverlayLayer.tsx`)
- In the `rects` branch, emit `<polygon>` when `points.length >= 3`, otherwise the current `<rect>`. Same stroke/fill/dash/width tokens and `data-export-kind` attribute so the export capture path picks it up unchanged.
- Label docking and the obstacle list for the placement optimizer keep using the envelope.

**Vertex editing** (`DocumentSurface.tsx`)
- Extend `EditorBbox` to carry `points`. When present, render the polygon outline, a vertex handle per point, and a ghost midpoint handle per edge (lower opacity, appears on hover of the edge region).
- Reuse the existing `startEditorDrag` pointer-capture pattern: `handle: { kind: "vertex", index }` and `{ kind: "midpoint", index }`.
- Vertex pointerup with total movement < 5px and `points.length > 3` deletes the vertex; midpoint pointerdown inserts a vertex and immediately begins dragging it.
- Shift during a vertex drag snaps to the previous/next vertex's x or y, whichever axis is closer.
- `move` translates all points; the n/s/e/w/corner handles scale all points against the envelope so existing resize behaviour is preserved.
- Emit `onEditorBboxChange({ nx, ny, nw, nh, points })` with the envelope recomputed each frame.

**Containment consumers** (switch envelope test to `pointInPolygon` when `points` exists, envelope otherwise)
- `FileViewerModal.tsx`: `findPlanContaining` (~line 1948), per-plan membership (~line 2264), and marker drag clamping (~lines 1049-1149; clamp to the nearest point inside the polygon rather than the inner rect).
- `WorkbenchProjectDetail.tsx`: `pairsForPage` / `surveyDerivedMaps` level and unit attribution, and attachment-count badges.
- `ConsolidateRisersModal.tsx`, `SpatialArchitectModal.tsx`: bbox pickers read the same helper.
- `useFitToSelection.ts` keeps using the envelope.

**Export paths**
- `threatReportPageCapture.ts` / `pdfPageOverlayExport.ts` / `overlayOnlyCapture.ts`: draw a polygon path when points exist, applying `rotatePolygon` for the page's `userRotation` exactly where `rotateRect` is called today.
