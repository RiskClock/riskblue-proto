# Cluster-first radial label placement (viewer only)

Replace the randomized greedy optimizer with a proactive, spatial-allocation layout for the interactive drawing viewer. Exports (threat report, drawing downloads, offscreen capture) keep today's algorithm unchanged.

## What changes for the user

- Labels fan out around dense clusters in angular order, so leader lines stop crossing each other and stop shooting across the viewport.
- Isolated annotations get a label right next to their dot instead of being dragged into a crowd.
- Labels stay put while panning; one only moves if its old spot becomes invalid or a clearly better spot opens up.
- The pre-emptive density rule (hide labels wherever more than 3 anchors sit within 80 screen px) is removed. Every visible annotation is attempted, and a label is dropped only when no collision-free slot exists. Any annotation whose label is dropped renders its anchor dot fully opaque, so clusters stay readable.

## The new engine

Two placement engines live side by side in `overlayPlacement.ts`. `runPlacement` dispatches on a new `strategy` field: `"legacy"` (default, used by exports) or `"cluster"` (viewer).

Cluster pipeline:

1. **Inputs already culled.** The viewer keeps sending only annotations intersecting the buffered viewport, with `bounds` set to the clipped visible rect. Hard obstacles: structural rects, docked bbox label footprints, retained fixed labels, and the bounds edges. No label may ever overlap these.
2. **Cluster.** Build an rbush of visible labeled anchors and grow connected components using a proximity threshold of ~60 screen px converted to page units (`CLUSTER_PROXIMITY_PX / lodScale`). Sort clusters by member count descending; process largest first so crowded areas claim space before sparse ones.
3. **Radial placement (cluster size > 1).** Compute centroid and radius. Sort members by angle around the centroid. Walk them in angular order and, for each, probe outward along its own centroid ray in expanding steps (starting just outside the cluster radius, stepping by label height) plus a small angular window that never breaks the sorted order — the assigned angle is clamped between the previous member's used angle and the next member's raw angle. First position clear of all hard obstacles and already-placed labels wins.
4. **Isolated placement (cluster size 1).** Ring of local directional slots (right, left, above, below, then diagonals) at increasing distance from the anchor; first clear slot wins, nearest first.
5. **Stability.** The viewer passes `previousLabels` (id -> rect). A previously placed rect that is still fully inside bounds and clear of all obstacles is accepted immediately and locked as an obstacle before any new placement runs. Otherwise the candidate cost gains an inertia term proportional to distance moved, and a new slot replaces the old one only when it is at least `HYSTERESIS_RATIO` (0.25) cheaper.
6. **Suppression.** If every probe for a label collides, no `PlacedLabel` is emitted and its id goes into a new `suppressedIds` output list.

Leader lines may cross anchor dots; only label-over-label, label-over-hard-obstacle, and leader-over-leader are disallowed.

## Technical notes

- `src/components/viewer/overlayPlacement.ts`
  - `PlacementInput` gains `strategy?: "legacy" | "cluster"`, `previousLabels?: Array<{ id; x; y; w; h }>`, `clusterProximity?: number`.
  - `runPlacement` return type becomes `PlacementResult { placed: PlacedLabel[]; suppressedIds: string[] }`. To avoid touching every caller, keep `runPlacement` returning `PlacedLabel[]` and add `runPlacementDetailed` that returns the richer result; the worker protocol carries the detailed shape.
  - New internal module section: `clusterAnchors`, `placeCluster`, `placeIsolated`, shared `isClear(rect)` using the existing rbush label/rect/circle indexes. `separateResidualOverlaps` is not used by the cluster path (placement is collision-checked up front); it stays for legacy.
  - Rect (bbox) labels stay docked and excluded from movable targets, contributed as obstacles, exactly as today.
- `src/components/viewer/overlayPlacement.worker.ts` / `overlayPlacementClient.ts`: message payload carries `{ placed, suppressedIds }`; `requestPlacement` callback signature updated, sync fallback matched.
- `src/components/viewer/OverlayLayer.tsx`
  - Delete the `lodHiddenIds` density memo and its `lodHiddenKey`; `lodScale` is retained (it drives the cluster threshold and leader cap) and stays quantized so smooth zoom doesn't retrigger passes.
  - Placement targets become all labeled, non-dot circles intersecting the visible bounds.
  - Pass `strategy: "cluster"`, `clusterProximity`, and `previousLabels` from the existing per-id placement cache.
  - Track `suppressedIds` in state; `denseOpaque` on `CircleOverlay` is driven by that set instead of the old LOD set (hovered/selected still force the label and normal styling).
  - Structure key drops `lodHiddenKey`, keeps layout keys + `lodScale` + page size, so the cache still clears when annotations or zoom bucket change.
  - The sync/export branch keeps `strategy: "legacy"`, full-page bounds, no viewport, no `previousLabels`.
- Constants block at the top of `OverlayLayer.tsx`: replace `LOD_NEIGHBORHOOD_PX` / `LOD_MAX_NEIGHBORS` with `CLUSTER_PROXIMITY_PX = 60`; keep `LOD_SCALE_QUANTIZE`, `VIEWPORT_BUFFER_RATIO`, `LEADER_SOFT_CAP_SCREEN_PX`.
- Cost/geometry constants for the cluster path (`RADIAL_STEP_FACTOR`, `INERTIA_WEIGHT`, `HYSTERESIS_RATIO`, `ISOLATED_RING_STEPS`) go in one block in `overlayPlacement.ts`.

## Validation

- Dense page (2102 Mechanical Schematics p2) at several zoom levels: no pill overlaps another pill, a bbox, a docked bbox label, or the bounds edge; leader lines within a cluster do not cross; suppressed anchors render as solid dots.
- Pan in small and large steps: labels that remain valid do not move.
- Zoom in on a cluster: suppressed labels progressively appear as space opens.
- Re-export the same page and the threat report and confirm the output layout is identical to before this change.
