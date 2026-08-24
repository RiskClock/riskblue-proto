# Drawing viewer: LOD, thicker strokes, zoom hysteresis, hover highlight

## 1. Restore density LOD when zoomed out

Right now every labelled annotation inside the viewport is sent to the placement engine, so at low zoom the sheet fills with pills. Reinstate the local density pass before placement:

- Build a screen-space spatial index of visible anchors.
- For each anchor, count neighbors within a fixed screen radius. More than 3 neighbors means "low detail": no label, no leader line, and the anchor dot renders fully opaque (same treatment already used for collision-suppressed anchors).
- The density pass runs on the whole page (not just the viewport) so labels don't pop as you pan, and uses the settled zoom scale so the set only changes once a zoom gesture finishes. Zooming in naturally thins the neighbor counts, so labels return progressively.
- Low-detail anchors are excluded from the placement engine entirely (no candidate generation, no cost math), and still keep the existing behavior where hovering or selecting one shows its label docked beside the dot.

## 2. Thicker leader lines and annotation borders

- Annotation circle border: 2px to 3px at rest.
- Leader line: 1.25px to 2.25px.
- Constant on-screen thickness is preserved (values continue to be divided by the current zoom scale), and export paths inherit the same values so downloads match the viewer.

## 3. Zoom hysteresis for label positions

Panning already retains cached label positions; extend the same behavior to zoom:

- Cached positions are kept across a zoom change instead of being cleared when the zoom-derived layout key changes.
- A retained label is only re-placed when it becomes invalid at the new zoom: it falls outside the viewport, is clipped by its edge, or now collides with a hard obstacle or another retained label.
- Only the offending label is re-placed; every other label stays exactly where it was. Newly visible anchors (zoom-out) are placed into whatever space remains, and if one can't be placed cleanly it is suppressed as an opaque dot rather than forcing a global reshuffle.
- Label footprints still rescale with zoom, so re-validation uses the new footprint size.

## 4. Hover highlight on annotation and label

Hover on either the anchor dot or its label pill highlights the pair:

- Label pill becomes hover-interactive (pointer events enabled for hover; clicks continue to pass through to the canvas beneath).
- On hover: circle border, leader line, and label pill render fully opaque. The circle's fill opacity is unchanged.
- On hover: circle border, leader line, and label border each gain 1px on top of the new baselines (border 3px to 4px, leader 2.25px to 3.25px).
- Hover highlight layers on top of an active pulse animation rather than cancelling it.

## Technical notes

- `src/components/viewer/OverlayLayer.tsx` — density LOD pass (rbush, screen-radius neighbor count), `lowDetailIds` set feeding `denseOpaque` and excluded from `placementTargetIds`; new stroke constants; hover state shared between `CircleOverlay` and the label pill; label pill `pointerEvents` for hover with click pass-through.
- `src/components/viewer/overlayPlacement.ts` — accept a low-detail exclusion list; validation-based retention so only invalid labels are re-placed on zoom (position cache no longer invalidated wholesale by the zoom component of the structure key).
- Export/capture paths (`threatReportPageCapture.ts` and the sync placement branch) pick up the new stroke widths; the density LOD stays viewer-only unless labels are toggled off.
