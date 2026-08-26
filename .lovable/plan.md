# Why CW-Shut-off Valve-019's label ends up across the sheet

## What the code actually does

Confirmed in `src/components/viewer/overlayPlacement.ts` (`runClusterPlacement`):

1. **Clusters are transitive chains, not tight groups.** Anchors are grouped by connected components with a 60-screen-px proximity (`CLUSTER_PROXIMITY_PX / lodScale`). A chain of annotations that are each near the *next* one merges into one cluster of up to `MAX_CLUSTER_SIZE = 30`. On a riser schematic like this page, one cluster easily spans a large part of the sheet.
2. **Every cluster member is pushed outside the whole cluster hull.** For clusters with more than one member the only candidate generator is radial from the cluster **centroid**:
   `baseDist = max(clusterRadius + gap, distFromCentroid + r + gap) + minLeader`, then rings step outward from there. `clusterRadius` is the distance from the centroid to the farthest member. So a member sitting near the centroid gets its label placed on the outer hull of the entire cluster — a leader hundreds of px long, crossing the whole group. That is exactly the CW-Shut-off Valve-019 case: it is a member of the big valve/meter cluster and its label was flung to the ring while CW-Meter-044/045 and RS-DCHW-006 keep short leaders because they sit near the hull already.
3. **Nearby free space is never tried for cluster members.** `placeIsolated` (rings around the anchor itself) runs only as a fallback if radial placement returns nothing. Since the hull ring almost always has a free slot, the local slot next to the anchor — which visibly exists — is never evaluated.
4. **The cluster path has no leader-length cost.** `leaderSoftCap` is only consumed by the legacy/export placer. In `costOf` the cluster path adds leader length linearly, so a 400px leader on the ring beats nothing; there is no term that makes a long leader lose to a shorter, slightly penalised slot.
5. **Leader crossing is only a soft cost (220) inside the cluster path**, and the angular ordering that is supposed to prevent crossings only holds for labels placed on the shared ring. With long radial leaders passing through the cluster interior, crossings over other anchors and pills are effectively guaranteed.

So the label is not being placed far because it lacks space — the algorithm proactively sends it to the cluster hull.

## The fix

Viewer (`strategy: "cluster"`) only. The legacy/export placer is untouched.

1. **Local-first for cluster members.** For each cluster member, evaluate anchor-local rings (the existing `placeIsolated` generator) *before* the centroid-radial rings. Accept the local slot when it is clean. Only fall through to the radial hull fan when no clean local slot exists within the local rings. This keeps every annotation's label next to its own dot whenever there is room, and reserves radial fanning for genuinely packed knots.
2. **Bound the radial base distance.** Cap `baseDist` so it can never exceed the anchor's own distance plus a leader budget: `min(hullBase, anchorRadius + gap + minLeader + MAX_RADIAL_EXTRA)` where `MAX_RADIAL_EXTRA` derives from a screen-px budget (~140 px, the existing `LEADER_SOFT_CAP_SCREEN_PX`, converted through `lodScale`). Labels then fan around the *local* neighbourhood instead of the whole chain.
3. **Give the cluster path a leader-length cost.** Thread the existing `leaderSoftCap` into `costOf` for the cluster strategy as a quadratic term past the cap, so a long ring slot loses to a nearer slot that carries a soft penalty (soft-rect or dot). `OverlayLayer` already computes and passes `leaderSoftCap`; only the cluster cost function needs to read it.
4. **Tighten clustering so chains don't merge.** Reduce `MAX_CLUSTER_SIZE` (30 -> 12) so `splitOversized` breaks long chains into local fans, and split on spatial extent as well as count: if a component's bounding-box span exceeds a screen-px budget, split it even when the member count is under the limit.
5. **Raise leader crossing weight** in the cluster path now that leaders are short (crossings become rare and genuinely avoidable), so the remaining choices prefer non-crossing slots.

## Technical notes

- `src/components/viewer/overlayPlacement.ts`
  - Add `LOCAL_FIRST_RING_STEPS`, `MAX_RADIAL_EXTRA_FACTOR`, `MAX_CLUSTER_SPAN` constants next to the existing cluster constants block.
  - Refactor `placeIsolated` into `localRings(t, steps)` so both isolated anchors and cluster members reuse the generator.
  - Cluster loop: `const chosen = chooseByRings(t, localRings) ?? chooseByRings(t, radialRings) ?? placeLastResort(t)`.
  - `costOf` gains the `leaderSoftCap` quadratic term (`((leader - cap)/40)^2 * 1000`, matching the legacy formulation) when `input.leaderSoftCap` is set.
  - `splitOversized`: add the span test alongside the count test.
- `src/components/viewer/OverlayLayer.tsx`: no behavioural change required; verify `leaderSoftCap` and `minLeader` are still passed for the cluster branch and remain `undefined` for the sync/export branch.

## Validation

- Page 1 of `1640-GDM-XX-ZZ-SC-P-7501_Dom Water Schematic_T2.pdf` at ~211%: CW-Shut-off Valve-019 sits adjacent to its own dot; no leader crosses the CW-Meter-044/045 / RS-DCHW-006 group.
- Dense mechanical page at several zoom levels: no pill-on-pill overlap, no pill on a foreign dot, leaders stay within roughly 28-140 screen px.
- Pan and zoom: retained labels still do not jump (hysteresis path unchanged).
- Re-export the same page and the threat report and confirm the exported layout is unchanged for the legacy path, and improved-but-stable for the report's cluster render.
