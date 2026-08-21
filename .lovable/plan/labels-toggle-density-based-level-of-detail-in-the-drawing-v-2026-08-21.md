# Labels toggle + density-based Level of Detail in the drawing viewer

Two changes to how annotation labels are drawn on the drawing canvas: an internal-only on/off switch, and a local-density LOD system that hides labels only where the drawing is crowded, revealing them as you zoom in.

## 1. Labels / leader lines toggle (internal users only)

- New icon button (Tag icon, ghost, small) placed immediately after the file name in the drawing modal title, in the same row as the existing title accessory.
- Visible only to internal users (reuse the same flag that gates the Scout Page / Scout Debug buttons).
- Default ON. Off hides annotation labels and their leader lines; the anchor dots stay. Bounding-box (floor plan) labels are unaffected.
- State persists per user in localStorage so it survives reopening the modal.
- Viewer only: downloads/exports keep rendering every label as they do today.

## 2. Local density LOD for annotation labels

Replaces "draw every label always" with a per-annotation decision based on how crowded that annotation's immediate screen neighborhood is.

- For each labeled annotation anchor, a screen-space square (default 80x80 CSS px, converted to page units by dividing by the current zoom scale) is queried against an rbush index of all anchors.
- More than 3 other anchors inside that square: low detail — anchor dot only, no label, no leader line.
- Otherwise: high detail — label and leader line as today.
- Zooming in expands screen distance between anchors, so clusters progressively resolve into labeled annotations. Zooming out re-collapses them.
- The hovered or selected annotation always renders its label even when flagged low detail, with a leader line from its anchor.
- Applies to the interactive viewer only; export/threat-report capture keeps the current full-label behavior (the synchronous placement path is left unchanged).

## 3. Placement optimizer skips low-detail annotations

`runPlacement` currently generates candidates and runs collision/cost optimization for every labeled circle. It will accept an optional set of low-detail ids and:

- exclude them from candidate generation and the optimizer entirely (no output entry for them),
- still keep their circles in the obstacle list so surviving labels avoid drawing over them.

In dense pages this removes the majority of the work per pass.

## Technical notes

- `src/components/viewer/overlayPlacement.ts`: add `lodHiddenIds?: string[]` to `PlacementInput`; filter `labeledCircles` by it before candidate generation while `allCircles` (obstacles) stays complete.
- `src/components/viewer/OverlayLayer.tsx`:
  - new `showLabels?: boolean` prop (default true) and reuse of existing `viewScale`;
  - build an rbush of anchor points and compute the low-detail id set in a memo keyed by anchors + a quantized `viewScale` (rounded to ~10% steps) so a smooth pinch-zoom doesn't retrigger a placement pass on every frame;
  - pass the set into `buildPlacementInput`; add the quantized scale to the async placement effect deps (the sync/export path stays on the current deps and gets no LOD);
  - skip rendering label pills and leader lines for low-detail ids, except when the id equals `hoveredId`/`selectedId`.
- `src/components/viewer/DrawingViewer.tsx`: thread `showLabels` through to `OverlayLayer`.
- `src/components/wizard/FileViewerModal.tsx`: toggle button in the `DialogTitle` row, localStorage-backed state, passed down to `DrawingViewer`.
- Tunables in one constants block at the top of `OverlayLayer.tsx`: `LOD_NEIGHBORHOOD_PX = 80`, `LOD_MAX_NEIGHBORS = 3`, `LOD_SCALE_QUANTIZE = 0.1`.
