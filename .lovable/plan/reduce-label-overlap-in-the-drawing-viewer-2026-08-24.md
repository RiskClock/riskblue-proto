# Reduce label overlap in the drawing viewer

## How placement works today

Confirmed from `src/components/viewer/overlayPlacement.ts` and `OverlayLayer.tsx`:

1. **Candidate generation.** Each labeled circle gets 4 rings x 32 directions = 128 candidate pill positions, at `r + gap + [20, 50, 100, 180] * scale` px. Candidates that would sit on their own circle are only used as a last resort. Bbox (rect) labels get 36 docked candidates around the box.
2. **Cost function.** Per candidate: leader length + horizontal offset x0.5 + below-anchor x1.5 + right-of-anchor x0.75, plus penalties — label/label overlap 1,000,000 (checked against a 6px-inflated footprint), label over a foreign dot 100,000, over a rect footprint 50,000 (1,000,000 if it is a retained "fixed" label), label sitting on someone's leader 900,000, leader crossing leader 80,000.
3. **Optimizer.** Randomized-order greedy relaxation, up to 6 sweeps, 3-4 random restarts, best total cost wins, 1.5s budget. rbush indexes for dots, rects, labels, leaders.
4. **Two passes.** Rect labels are placed first and become obstacles for circle labels.
5. **Final safety pass.** `separateResidualOverlaps` pushes still-overlapping circle pills apart along the axis of least penetration, 40 passes, clamped to bounds.
6. **Viewer specifics.** Density LOD hides labels in crowded clusters (>3 neighbours in 80 screen px); placement is culled to the buffered viewport; retained labels from the pan cache are passed in as `fixedLabels` obstacles.

## Why overlaps still appear (the screenshots)

- The final separation pass only sees labels produced in the current placement call. Retained cache labels are obstacles during optimization but are **not** part of the separation pass, so a newly placed pill nudged out of one collision can land on a retained pill with nothing to correct it.
- Separation ignores dots entirely — it resolves label/label penetration only, so a pill pushed clear of a neighbour can end up parked on an annotation circle.
- Separation uses zero padding (`ox/oy > 0`) while the optimizer reserves 6px, so results are "touching but legal".
- Nothing penalises long leaders beyond linear cost, so in the culled viewport an anchor near the edge can still pull its pill deep into the centre where the crowd is.

## Levers, in order of value

1. **Feed retained labels into the separation pass as immovable rects.** Highest impact, smallest change: the pass already supports immovable entries (rect kind).
2. **Add dots to the separation pass.** After pushing pills apart, run a short repair loop: if a pill covers a foreign circle, push it out along the circle-centre-to-pill-centre axis.
3. **Give separation the same 6px padding the optimizer uses**, so the final layout matches the reserved footprint instead of settling flush.
4. **Cap leader length in the viewer.** Add a soft quadratic term past a threshold (e.g. cost += ((leader - 120)/40)^2 * 1000) so distant anchors prefer a nearer, slightly worse slot over a long line into the crowded middle. Export path keeps the current linear cost.
5. **Denser candidate ladder in tight clusters.** Add an intermediate ring (e.g. 35px) and allow half-step angles for labels whose best candidate still carries a penalty, rather than raising the count globally.
6. **Tune LOD.** `LOD_MAX_NEIGHBORS = 3` / `LOD_NEIGHBORHOOD_PX = 80` are the cheapest knobs — dropping to 2 neighbours or widening to 100px removes a large slice of the collisions at the cost of showing fewer labels when zoomed out.
7. **Escalation instead of acceptance.** If a label's best cost still contains `OVERLAP_PENALTY` after the optimizer, retry it alone against the final layout with an extended ring set before falling back.

## Proposed scope for this change

Implement 1, 2, and 3 (correctness fixes to the final pass) plus 4 (viewer-only leader cap). Leave 5-7 as tuning follow-ups once we see the result.

- `src/components/viewer/overlayPlacement.ts` — extend `separateResidualOverlaps` to accept immovable `fixedLabels` and the circle index, add padding, add dot repair loop; add optional `leaderSoftCap` to `PlacementInput` used in `candidateCost`.
- `src/components/viewer/OverlayLayer.tsx` — pass `leaderSoftCap` for the interactive viewer only (undefined on the sync/export path, so exports are unchanged).

## Verification

Open a dense page (2102 Mechanical Schematics page 2) at high zoom, pan around, and confirm: no pill intersects another pill or a retained pill, no pill sits on a foreign dot, and leader lines stay short. Re-export the same page and confirm the exported layout is unchanged.
