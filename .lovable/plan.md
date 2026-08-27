# Zoom-in label re-evaluation + stronger hover highlighting

## 1. Re-evaluate only the far-flung labels

Today the placement cache retains every label across zoom and pan unless it is clipped or collides. A label that was flung far from its anchor in a crowded state therefore stays flung forever, even after zooming in opens space.

New behaviour, viewer only:

- Track the previous settled scale and previous visible bounds in `OverlayLayer`.
- Trigger a re-evaluation pass when either the settled scale increased (zoom in) or the visible bounds moved (pan) — never on zoom out.
- On such a pass, compute each retained label's leader length (anchor centre to label rect edge). Any label whose leader exceeds the current soft cap is evicted from the cache and added to the list of labels the worker must place. Everything under the cap stays exactly where it is.
- Cap the eviction to the worst 8 offenders per pass (longest leaders first) so a continuous pan can't cause a global reshuffle.
- Hysteresis on acceptance: when the worker returns a new position for an evicted label, keep it only if its leader is at least 25% shorter than the old one. Otherwise the old position is restored, so a label never jitters between two equally bad slots.
- Retained labels are already passed as fixed obstacles, so re-placed labels cannot land on stable ones.

## 2. Stronger hover highlight on the canvas

Hovering an anchor dot or its label pill currently only outlines the pill. Extend it so the whole trio reads as one highlighted unit:

- Leader line switches to the same emphasis colour used for the pill outline (black / readable-on-color) at full opacity, in addition to the existing +1px thickness.
- Annotation circle border switches to that same emphasis colour at full opacity, keeping the current +1px thickness and unchanged fill opacity.
- Pill outline unchanged.

## 3. Two-way hover between canvas and the side lists

- `OverlayLayer` gains an `onHoverChange` callback, threaded up through `DocumentSurface` and `DrawingViewer` as `onOverlayHoverChange`.
- `FileViewerModal` holds a single hovered-annotation id and derives both directions: hovering on canvas highlights the matching side-panel row, hovering a side-panel row highlights the canvas annotation (existing `hoveredOverlayId` path).
- Applies to both lists:
  - Floor Plans tab annotation chips (currently inert) get pointer enter/leave handlers.
  - Detections tab cards, merging with the existing `hoveredCode` state.
- Hovered row styling: text becomes bold and the background hover tint is darkened one step (chips go from their soft class tint to a stronger tint; detection cards go from `muted/50` to `muted`).

## Technical notes

- `src/components/viewer/OverlayLayer.tsx` — prev-scale/prev-bounds refs, leader-length computation over the retained cache, capped eviction, acceptance hysteresis in the worker callback, hover colour for leader `stroke` and circle border, new `onHoverChange` prop fired from both the dot and the pill.
- `src/components/viewer/DocumentSurface.tsx`, `DrawingViewer.tsx` — pass `onOverlayHoverChange` through.
- `src/components/wizard/FileViewerModal.tsx` — hovered annotation id state shared by canvas and both lists; chip and detection-card hover styling.
- Export and sync placement paths are untouched: re-evaluation is gated on the async viewer branch only.

## Validation

- On the Dom Water Schematic page 1, zoom in on a cluster: only the long-leader labels move; short-leader labels stay pinned.
- Pan into empty space: a long-leader label pulls in; repeated small pans do not cause continuous movement.
- Zoom out: no re-evaluation, labels only move when they become invalid.
- Hover a dot, a pill, a chip, and a detection card: annotation border, leader, pill and the matching list row all highlight together.
