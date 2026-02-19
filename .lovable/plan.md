# Auto Fit-Selection on Modal Open (with 4 Safeguards)

## What needs to change

One file: `src/components/analysis/AnalysisSection.tsx`

Three targeted edits:

1. Add `const didAutoFitRef = useRef(false);` alongside the existing refs in `InstanceDetailModal` (only declare it here — do not redeclare it inside the fit-selection effect).
2. Reset scroll + reset `didAutoFitRef` in the Step 2 `[pageImage]` effect
3. Insert the new fit-selection `useEffect` between Step 3 (line 505) and the zoom handlers (line 507)

---

## Current code anchor points

- **Line 354–355** — existing refs (`canvasRef`, `containerRef`): add `didAutoFitRef` here
- **Lines 446–465** — Step 2 effect (`[pageImage]`): add `containerRef.current?.scrollTo({ left: 0, top: 0 })` and `didAutoFitRef.current = false` after `setZoom(1)` on line 464
- **Line 505** — end of Step 3 effect `}, [pageImage, baseDimensions, zoom, rawCoords, pdfViewport, offscreenSize]);` — insert fit-selection `useEffect` immediately after

---

## The new fit-selection useEffect (full code)

Inserted after line 505, before line 507 (`const handleZoomIn`):

```typescript
// Step 4: Auto fit-selection — fires once per modal open when all data is ready
// uses didAutoFitRef declared above with other refs

useEffect(() => {
  // Guard: only run once per load
  if (didAutoFitRef.current) return;
  if (!rawCoords || !pdfViewport || !offscreenSize || !baseDimensions) return;
  const container = containerRef.current;
  if (!container) return;

  // Convert PDF user-space → offscreen canvas pixels
  const [vx1, vy1, vx2, vy2] = pdfViewport.convertToViewportRectangle([
    rawCoords.x1, rawCoords.y1, rawCoords.x2, rawCoords.y2,
  ]);

  // Normalise to [0..1] and map to base canvas pixels (zoom = 1)
  const nx1 = Math.min(vx1, vx2) / offscreenSize.w;
  const ny1 = Math.min(vy1, vy2) / offscreenSize.h;
  const nx2 = Math.max(vx1, vx2) / offscreenSize.w;
  const ny2 = Math.max(vy1, vy2) / offscreenSize.h;

  const bx = nx1 * baseDimensions.width;
  const by = ny1 * baseDimensions.height;
  const bw = (nx2 - nx1) * baseDimensions.width;
  const bh = (ny2 - ny1) * baseDimensions.height;

  // Safeguard 1: skip zero-size bbox
  if (bw <= 1 || bh <= 1) return;

  // Compute fit zoom (20% padding, clamped 1.0–4.0)
  const PADDING = 0.20;
  const fitScale = Math.min(
    container.clientWidth  / (bw * (1 + PADDING)),
    container.clientHeight / (bh * (1 + PADDING)),
  );
  const targetZoom = Math.min(4.0, Math.max(1.0, fitScale));

  // bbox center in zoomed-canvas pixels (used inside double-RAF closure)
  const cx = (bx + bw / 2) * targetZoom;
  const cy = (by + bh / 2) * targetZoom;

  // Mark as done before applying (prevents any re-entry)
  didAutoFitRef.current = true;

  setZoom(targetZoom);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const c = containerRef.current;
      if (!c) return;
      // Safeguard 2: non-negative clamp for maxLeft/maxTop
      const maxLeft = Math.max(0, c.scrollWidth  - c.clientWidth);
      const maxTop  = Math.max(0, c.scrollHeight - c.clientHeight);
      const left = Math.min(maxLeft, Math.max(0, cx - c.clientWidth  / 2));
      const top  = Math.min(maxTop,  Math.max(0, cy - c.clientHeight / 2));
      c.scrollTo({ left, top }); // instant, no animation
    });
  });
}, [rawCoords, pdfViewport, offscreenSize, baseDimensions]);
```

---

## Step 2 additions (reset on new image load)

Inside the `[pageImage]` effect, after `setZoom(1)` on line 464:

```typescript
setZoom(1);
// Safeguard 3: reset scroll position
containerRef.current?.scrollTo({ left: 0, top: 0 });
// Safeguard 4: allow auto-fit to fire again for the new image
didAutoFitRef.current = false;
```

---

## Why this is safe against loops

The dep array is `[rawCoords, pdfViewport, offscreenSize, baseDimensions]`. All four are set during PDF load and never changed by zoom or scroll operations. `didAutoFitRef.current` is set to `true` before calling `setZoom`, so even if `setZoom` somehow re-triggered this effect (it can't — `zoom` is not in the dep array), the guard at the top would exit immediately.

The Step 2 effect resets `didAutoFitRef.current = false` whenever a new image loads (`[pageImage]` dep), which is exactly what allows the fit to re-run on the next modal open.

---

## Sequencing of all effects per modal open

```text
1. Step 1 effect fires (new sourceFile/instance):
   → resets all state to null, setZoom(1)

2. PDF downloads + renders → setPageImage(img)

3. Step 2 effect fires ([pageImage]):
   → sets baseDimensions, setZoom(1)
   → scrollTo(0, 0)               ← Safeguard 3
   → didAutoFitRef.current = false ← Safeguard 4

4. Step 3 effect fires ([..., baseDimensions]):
   → draws image + red bbox overlay onto canvas at zoom=1

5. Fit-selection effect fires ([rawCoords, pdfViewport, offscreenSize, baseDimensions]):
   → guard: didAutoFitRef.current is false → proceeds
   → guard: bw/bh > 1 → proceeds
   → computes targetZoom, sets didAutoFitRef.current = true
   → setZoom(targetZoom)

6. Step 3 redraws at targetZoom (zoom changed)

7. double-RAF fires → scrollTo(left, top) with clamped scroll
```

---

## Files changed


| File                                          | Lines touched                                                                                                      |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `src/components/analysis/AnalysisSection.tsx` | Add `didAutoFitRef` at line ~355; 2 lines in Step 2 effect at line ~464; new `useEffect` (30 lines) after line 505 |


No DB changes. No new dependencies. No edge function changes.