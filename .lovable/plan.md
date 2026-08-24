# Fix: cluster placement suppresses nearly every label

## What the code actually does today

Confirmed in `src/components/viewer/overlayPlacement.ts` (`runClusterPlacement`) and `src/components/viewer/OverlayLayer.tsx`:

1. **Bounding boxes are hard obstacles covering the whole drawing.** `OverlayLayer` builds `rectObstacles` from every bbox — the full rect footprint plus its docked label footprint — and the cluster engine loads all of them into `hardIdx`. `hitsHardOrLabel` rejects any candidate overlapping a hard rect, and `tierOf` returns `-1` for it. Since a level/space bbox typically spans the entire sheet, **every** candidate inside it is rejected, so almost every label is suppressed. This matches the screenshots exactly: page 2 of The Cottage (green bbox over the whole plan) shows zero labels; the ARQUITECTURA page shows labels only in the thin strip *above* the pink bbox; zoomed to 375% inside the bbox, none at all.
2. **Label footprints are reserved at full page-unit size while being rendered at constant screen size.** Placement uses `fontPx = 13`, `labelH = 19` in page units, but the rendered pill is `sizing.font / viewScale`. At 375% zoom the reserved box is ~3.75x too large per axis (~14x the area), so collisions are fabricated where there is visibly ample space. This is the second reason zooming in makes things worse rather than better.
3. **Leader-crossing is a hard rejection**, not a cost. `tierOf` returns `-1` when the new leader crosses any committed leader, so in any cluster the later members lose most of their candidates.
4. **No last-resort placement.** If every probe fails, the label is dropped. There is no relaxed retry, so a single strict rule (bbox, oversized footprint, leader crossing) turns straight into a hidden label.

Leader length itself is not a hard constraint in the cluster engine (`leaderSoftCap` is only used by the legacy/export path), so long-line rules are not what is hiding labels.

## The fix

Viewer (`strategy: "cluster"`) only. The legacy/export path stays byte-for-byte in behaviour.

1. **Split obstacles into hard and soft.**
   - Hard: bounds edges, docked bbox *label* footprints, retained fixed labels, already-placed labels.
   - Soft: bbox rect *areas*. Overlapping a bbox interior becomes a small cost, not a rejection. This restores the intent — annotation labels must avoid the bbox's docked label, not its whole area.
2. **Reserve the footprint at rendered size.** Pass zoom-aware `fontPx`, `padX`, `labelH`, and `charPx` (divided by the quantized zoom scale, matching `labelSizingForZoom`) for the cluster strategy, so the reserved pill equals the drawn pill. Export/sync keeps full-size reservation. Measured widths are measured at the same font size used for reservation.
3. **Demote leader crossing to a cost.** Ranking becomes tier 0 (clear), tier 1 (crosses a leader or covers a foreign dot), with tier 1 only used when no tier 0 slot exists on any ring.
4. **Add a last-resort slot.** If all rings fail, place the label at the nearest in-bounds position that clears only the hard obstacles, ignoring soft ones. Suppress only when even that fails.
5. **Widen the probe set** so ample space is actually found: more angular offsets for isolated anchors and a couple more radial steps, now cheap because footprints shrank.

## Technical notes

- `overlayPlacement.ts`
  - `PlacementInput` gains `softRectIds?: string[]` (or a `soft` flag on rect entries) so the cluster engine can separate hard from soft rects; legacy ignores it.
  - `runClusterPlacement`: build `softIdx` alongside `hardIdx`; `tierOf` returns `0 | 1 | -1` with soft-rect and leader-cross hits folded into `costOf` / tier 1; add `placeLastResort(t)` scanning an expanding spiral against hard obstacles only.
  - Constants: add `SOFT_RECT_PENALTY`, `LEADER_CROSS_PENALTY`, `DOT_PENALTY`; bump `ISOLATED_DIRECTIONS_DEG` to 12 directions and `RADIAL_MAX_STEPS` to 20.
- `OverlayLayer.tsx`
  - Compute `placementFontPx / placementPadX / placementLabelH / placementCharPx` from `labelSizingForZoom(lodScale)` divided by `lodScale` for the async (viewer) branch; keep `fontPx/padX/labelH/charPx` for the sync branch. Include them in the placement effect deps.
  - Mark the bbox rect entries as soft and keep the `__label` entries hard when building `rectObstacles`.
  - No change to `suppressedIds` → `denseOpaque` wiring; far fewer ids should land there.

## Validation

- The Cottage page 2 (bbox over the whole sheet): all 5 labels render; no pill covers the green bbox's docked label.
- ARQUITECTURA page 1 at 107% and 375%: labels appear next to their anchors inside the pink bbox, pill size on screen matches the reserved footprint, no pill-on-pill overlap.
- Pan at high zoom: labels that stay valid do not move.
- Re-export the same page and the threat report; layout identical to before this change.
