# Exported Threat Report: labels still overlap

## What the reads show

Both the modal and the export call the same `runPlacement`, so the optimizer code is not the difference. What differs is the *inputs* it gets, and one of those inputs does not scale with the others.

Confirmed from the code:

- Label footprint scales with `exportScale`: `fontPx = 13 * exportScale`, `padX = 4 * exportScale`, `labelH = 19 * exportScale`, and multi-line height `labelH + (lines-1) * round(fontPx*1.25)` (`OverlayLayer.tsx` 592-599, `overlayPlacement.ts` 557-568). The export uses `EXPORT_OVERLAY_SCALE = 1.5`; the modal uses `exportScale = 1`.
- The candidate search space does **not** scale: `generateCircleCandidates` uses hard-coded absolute ring distances `[20, 50, 100]` page-px (`overlayPlacement.ts` 175), and rect candidate offsets are likewise absolute.
- Page size also differs: the export rasterizes at a 1800px long edge (`threatReportExport.ts` 343), while the on-screen viewer page is the fitted viewport size (`DrawingViewer.tsx` 254-270), typically ~1000-1300px.

Net effect in the export: every pill is 1.5x larger in page px, the page is larger, but each label may only move 20/50/100px away from its circle. Dense clusters (the 7-line `CW-P B-005` pill in the screenshots) therefore run out of non-colliding candidates and the optimizer settles for a placement carrying `OVERLAP_PENALTY` — a visible overlap. On screen the same clusters have both a smaller footprint and proportionally larger escape rings, so they resolve.

This is the most likely cause given the reads, but it is not yet measured — so the first step is to confirm it before changing the optimizer.

## Step 1 — Confirm

Add a temporary dev-only instrumentation path that runs `runPlacement` twice on the same page data (one L01-style dense page): once with the modal's inputs (`exportScale = 1`, viewer page size) and once with the export's (`exportScale = 1.5`, 1800px page), and count overlapping placed-label pairs plus how many placements ended up carrying the overlap penalty. If the export run shows overlapping pairs and the modal run shows none, the diagnosis holds and Step 2 applies. If both show zero, the overlap is introduced after placement (rendering/rasterizing) and the plan is revised.

## Step 2 — Make placement scale-invariant

- Add an explicit `scale` field to `PlacementInput` (the export passes `exportScale`, the viewer passes 1) and multiply the candidate ring distances and the rect candidate offsets by it, so the search space grows with the labels.
- Additionally scale the rings by the page's size relative to the reference used when the constants were tuned, so a 1800px export page searches proportionally as far as a 1200px viewer page.

## Step 3 — Guarantee no residual overlap

Even with a larger search space, extremely dense pages can exhaust candidates. Add a final de-overlap pass after `optimizePlacements`:

- Walk placed labels in reading order; for each pair that still intersects, push the later one along the axis of least penetration until clear, keeping it inside the page bounds and re-anchoring its leader.
- If a label cannot be cleared without leaving the page, allow a further outward ring (extend to a 4th ring at ~180px x scale) rather than accepting the overlap.

Leader lines are recomputed from the final rects, so they follow the adjusted positions.

## Scope

- `src/components/viewer/overlayPlacement.ts` — scale-aware candidates, extra ring, final de-overlap pass.
- `src/components/viewer/OverlayLayer.tsx` — pass `scale` into the placement input.
- No change to the on-screen viewer output (scale 1 keeps today's constants), no backend change.
- Both export consumers benefit: Threat Report DOCX page images and the annotated PDF download.

## Verification

Re-export the L01/L02 pages from the screenshots and compare against the modal: no pill may intersect another, and multi-instance pills stay fully legible.
