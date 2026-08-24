# Fix label proximity, modal autofocus, and zoom-time placement

## 1. Labels sit on top of their anchors

Since footprints became zoom-aware, the probe distances shrank with them. In `runClusterPlacement` the first candidate ring is at `t.r + gap + step` where `step = max(6, labelH * 1.15)` in page units — at 415% zoom that is only a few screen pixels, so the pill lands directly over the dot (visible in the screenshot: CDRM-001/002 pills touching their anchors, ELVP-001 covering its own dot).

Fix (viewer strategy only):

- Add `minLeader?: number` to `PlacementInput` (page units). `OverlayLayer` passes `MIN_LEADER_SCREEN_PX / lodScale` (~28 screen px) for the cluster path; exports leave it undefined.
- Isolated placement: first ring starts at `t.r + gap + minLeader`, then steps outward as today.
- Cluster radial placement: `baseDist` gains `minLeader`, so members always clear the cluster hull by a visible margin.
- Last-resort spiral: same `minLeader` floor, so even fallback labels keep a readable leader line.
- Add a cost term that penalizes candidates whose leader is shorter than `minLeader` (belt and braces for the previous-frame/hysteresis path, which can otherwise retain a too-close rect).
- Keep the existing `leaderSoftCap` upper bound, so leaders stay in a band (roughly 28-140 screen px) rather than being pushed far away.

## 2. Drawing modal steals focus

The dialog is a Radix `Dialog`, which focuses the first focusable child on open — that is the annotation-label toggle button next to the title. Add `onOpenAutoFocus={(e) => e.preventDefault()}` to the main `DialogContent` in `src/components/wizard/FileViewerModal.tsx`. Nothing receives a focus ring on open; Escape/close and tab order still work because Radix keeps the focus trap.

## 3. Placement recomputes during a zoom gesture

`OverlayLayer` derives `lodScale` from the live `viewScale` quantized to 0.1, and `lodScale` feeds the placement sizing, cluster proximity, structure key and cache invalidation. A single trackpad zoom crosses many 0.1 buckets, so the cache clears and a full pass runs repeatedly mid-gesture.

Fix: introduce a settled scale.

- In `DrawingViewer`, alongside the existing 150 ms `visibleRect` settle timer, publish a debounced `settledScale` on the same settle tick and pass it to `OverlayLayer` as a new optional prop (`placementScale`).
- `OverlayLayer` uses `placementScale ?? viewScale` for `lodScale` (placement math, sizing, proximity, cache key) while pill rendering keeps using the live `viewScale`, so pills stay crisp during the gesture and only the optimizer waits.
- Panning behaviour is unchanged (viewport rect is already settle-debounced).
- Export/sync path unaffected: it never receives `placementScale` and stays on `viewScale`/legacy.

## Technical notes

- `src/components/viewer/overlayPlacement.ts`: `PlacementInput.minLeader`; `MIN_LEADER_SCREEN_PX`-derived floor applied in `placeIsolated`, the cluster radial generator, `placeLastResort`, and a `SHORT_LEADER_PENALTY` in `costOf`.
- `src/components/viewer/OverlayLayer.tsx`: new `MIN_LEADER_SCREEN_PX = 28` constant, `placementScale` prop, `lodScale` sourced from it, `minLeader` in `buildPlacementInput`.
- `src/components/viewer/DrawingViewer.tsx`: settle-debounced scale state passed down to the overlay for the active page.
- `src/components/wizard/FileViewerModal.tsx`: `onOpenAutoFocus` guard on the viewer `DialogContent`.

## Validation

- The Cottage page 2 at 100% and 415%: every pill sits clearly off its dot with a visible leader line; no pill covers another pill or a docked bbox label.
- Zoom with the trackpad/buttons: labels hold their previous positions during the gesture and reflow once it settles.
- Pan: unchanged behaviour, valid labels do not move.
- Open the drawing modal: no button shows a focus ring; Escape still closes it.
- Re-export a page and the threat report: layout identical to before.
