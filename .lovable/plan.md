## Root cause

The exported page in the screenshot ("M001@Floo") is symmetrically chopped on both sides. That happens in `threatReportPageCapture.rasterizeViewerSurface` because:

- The offscreen pill canvas is sized to `div.getBoundingClientRect().width` (DOM width).
- Text is drawn with `ctx.font = "bold Npx ui-sans-serif, system-ui, …"` and `textAlign:"center"`.
- Inside the hidden offscreen container, custom app fonts aren't guaranteed to be loaded/applied, so canvas falls back to a wider system font. Canvas text ends up wider than the DOM pill → the centered draw is clipped on both edges.
- Additionally, the placement optimizer uses a heuristic (`charPx = fontPx * 0.82`) that underestimates wide glyphs (`@`, `M`, `W`, digits, `_`), so even the reservation pill can be smaller than the true rendered text.

## Changes

### 1. `src/components/viewer/OverlayLayer.tsx`

Add a small Canvas-based text measurement utility and use it whenever `syncPlacement` is on (export path). Async on-screen path can also opt in cheaply since it's memoized.

- New helper `measureLabelWidthPx(text, fontPx)`:
  - Lazily create a shared `<canvas>` and `CanvasRenderingContext2D`.
  - Set `ctx.font = 'bold ${fontPx}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'` — the *same* string used by the rasterizer.
  - Return `ctx.measureText(text).width`, plus a small safety epsilon (1px).
  - For multi-line labels, measure each line and return the max.
- In `buildPlacementInput()`, instead of passing a single `charPx` heuristic, precompute a per-circle `measuredWidthPx` for each labeled circle and pass those to the placement input. Fall back to the current `charPx` heuristic only when measurement isn't available (SSR/worker).
- Remove the `overflow: hidden` / `textOverflow: "ellipsis"` on the placed label `<div>` render path when `syncPlacement` is true. The main placed-labels branch already uses `whiteSpace: "pre"` and no maxWidth — audit and make sure nothing clips.
- For `RectOverlay`'s top-left docked label: when `syncPlacement` is on, drop `maxWidth: r.w`, `overflow: hidden`, and `textOverflow: "ellipsis"` so the full label renders. Keep `whiteSpace: "nowrap"`.
- Change `borderRadius: (3 / s) * exportScale` → `0` on the placed label pill so the exported bbox label is a sharp-cornered rectangle. (Applies to the docked rect label as well.)

### 2. `src/components/viewer/overlayPlacement.ts`

- Extend `CircleInput` (and internal reservation logic) with an optional `measuredWidthPx?: number`. When present, use it verbatim as the label's reserved width (plus `padX * 2`) instead of `label.length * charPx + padX * 2`.
- Keep the existing `charPx` field as a fallback so nothing breaks for callers that don't provide measurements.

### 3. `src/lib/overlayOnlyCapture.ts`

Guarantee custom fonts are loaded before rendering the offscreen overlay layer:

- Before `root.render(...)`, `await document.fonts.ready` (guarded with a short timeout so we never hang exports).
- Optionally, prime the specific font by calling `document.fonts.load('bold 13px ui-sans-serif')` (and any other sizes we actually render) before rendering.
- Attach an inline `<style>` node to the offscreen container that pins `font-family` on `[data-export-kind="label"]` to the exact same stack the canvas uses, so the DOM measurement (`getBoundingClientRect`) and canvas measurement agree.

### 4. `src/lib/threatReportPageCapture.ts`

- In `rasterizeViewerSurface`, before drawing labels: `await document.fonts.load(\`bold ${fontPx}px ui-sans-serif\`)` for each unique fontPx used (guarded).
- When drawing the pill:
  - Use the same font string the DOM label is styled with.
  - Measure `octx.measureText(line).width` and, if it exceeds the DOM `w`, expand the offscreen canvas width (and shift the composite `tl.x` left by the extra half) so the text is never clipped. This is the safety net if fonts still disagree.
  - Replace the rounded-rect path with a plain `octx.fillRect(0, 0, w, h)` + `octx.strokeRect(...)` (sharp corners) to match the on-screen bbox label.

### 5. `capturePageToPng` (same file)

- Also `await document.fonts.ready` (with short timeout) before `waitForViewerReady` returns success, so labels measured by the mounted `OverlayLayer` inside the offscreen container use the real fonts.

## Non-goals

- No changes to the on-screen viewer's ring distances or leader-snapping logic (already fixed in a prior turn).
- No visual change to circles, leaders, or the underlying PDF raster.

## Verification

- Rebuild the threat report for a page containing wide-glyph labels (`MRM001@Floor_1`, `MRM002@Floor_10`) and confirm the exported PDF pill shows the full text with sharp corners.
- Confirm on-screen viewer labels are unchanged (still rounded on-screen? — user asked only about the *bbox* label being sharp; if they want on-screen sharp too, we can flip that flag).

## Question for you

You said "the bbox label should be using sharp cornered rectangle." Do you mean:
- (a) only in the exported PDF (rect docked label + circle pills sharp on export), or
- (b) everywhere including the on-screen viewer?

I'll default to (b) — sharp corners everywhere — unless you say otherwise.
