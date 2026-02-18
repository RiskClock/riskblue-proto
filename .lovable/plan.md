
# InstanceDetailModal: Zoom Controls, Red Bounding Box Fix, Coordinate Display

## Root Causes Found

### 1. Bounding box never drawn — column name mismatch
The `parseCoordinatesFromResult` function (line 111–119) searches for a header containing `"coord"`. The actual AI output column is `"Bounding Box (x_min, y_min, x_max, y_max)"` — which does contain "coord" in the sense that `bounding box` does not. Wait — "coord" vs "bounding box" — the header is literally `Bounding Box (x_min, y_min, x_max, y_max)`. The function checks `h.includes("coord")` which fails to match `"bounding box"`.

**Additionally**, the function tries to find the instance row by matching `instanceId` (e.g. `SWC-B04`) in any cell. For the pipe-delimited format in the DB, the rows are not pipe-delimited — they use the format:
```
SWC-B04 | A2.01.pdf | ELECTRICAL SWC-B04 | ...  | (260, 500, 420, 620)
```
That IS pipe-delimited, so row matching should work — but only if the header is matched first.

**Fix**: Expand `coordCol` search to also match `"bounding"`, `"bbox"`, `"box"`.

### 2. Scale is wrong — AI uses 1024×768, code uses 2000×1500
The AI explicitly states: *"page width ≈ 1024 px, height ≈ 768 px"*. The current normalization divides by `W=2000, H=1500`, making all boxes 2x too small and offset. 

**Fix**: Change W/H to `1024`/`768` (the AI's stated coordinate space). Also parse the `(x_min, y_min, x_max, y_max)` format: four numbers in parentheses separated by commas.

### 3. Bounding box is blue, not red
Current: `rgba(59, 130, 246, ...)` (blue). User wants red.
**Fix**: Change to `rgba(239, 68, 68, 0.25)` fill, `rgba(239, 68, 68, 0.9)` stroke.

### 4. No zoom controls in InstanceDetailModal
The `LocationDetailsModal` renders PDF pages into `HTMLImageElement` arrays (via offscreen canvas at scale 4), then re-draws at `baseDimensions × zoom` on a display canvas. The `InstanceDetailModal` renders directly onto a single `<canvas>` with `scale: 1.5` and no zoom support.

**Fix**: Adopt the same two-step approach:
- Step 1: Render PDF page to offscreen canvas at high resolution (scale 4) → convert to `HTMLImageElement`
- Step 2: Display via a display canvas at `baseDimensions × zoom`, re-drawn when zoom changes
- Add `ZoomIn`, `ZoomOut`, reset (percentage label) buttons in a fixed toolbar above the drawing area

### 5. Bounding box must scale with zoom
After switching to the image-based zoom approach, the bounding box overlay must be re-drawn on the display canvas at each zoom level (scaled proportionally from the raw AI coordinates).

**Fix**: In the draw effect, after `ctx.drawImage(img, ...)`, compute bounding box pixel positions as fractions of the display canvas size and draw the red rectangle.

### 6. List coordinates in left panel
Add a "Bounding Box" field in the left panel of `InstanceDetailModal` showing the raw parsed coordinates (e.g. `(260, 500) → (420, 620)`). If no coordinates are available, show "—".

---

## Changes — one file only: `src/components/analysis/AnalysisSection.tsx`

### A. Fix `parseCoordinatesFromResult` — header matching + scale

Lines 103–175: Replace the entire function with an improved version that:
1. Matches column headers containing `"bounding"`, `"bbox"`, `"box"`, OR `"coord"` (case-insensitive)
2. Parses `(x_min, y_min, x_max, y_max)` four-number format: `\((\d+),\s*(\d+),\s*(\d+),\s*(\d+)\)`
3. Returns raw pixel coordinates (not normalized fractions) in the AI's 1024×768 space
4. Returns a new shape: `{ x1, y1, x2, y2, pageNum }` (absolute pixels in AI space)

Also add a companion `getBoundingBoxForInstance(resultText, instanceId)` that returns `{ x1, y1, x2, y2 } | null` for display in the left panel.

### B. Refactor `InstanceDetailModal` — zoom + image-based rendering

Replace the current state and render approach:

**State changes:**
```typescript
// Remove:
const [pdfArrayBuffer, setPdfArrayBuffer] = useState<ArrayBuffer | null>(null);

// Add:
const [pageImage, setPageImage] = useState<HTMLImageElement | null>(null);
const [zoom, setZoom] = useState(1);
const [baseDimensions, setBaseDimensions] = useState<{ width: number; height: number } | null>(null);
const [rawCoords, setRawCoords] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
const containerRef = useRef<HTMLDivElement>(null);
```

**Load effect (replaces first useEffect):**
- Download blob from storage
- Convert to ArrayBuffer
- `pdfjsLib.getDocument({ data: ab })` → get target page → `getViewport({ scale: 4 })` → render to offscreen canvas → `canvas.toDataURL()` → create `HTMLImageElement` → `setPageImage(img)`
- Parse bounding box from `resultText` using updated parser → `setRawCoords(...)`

**Base dimensions effect (new):**
- Triggered by `pageImage` change (not zoom)
- Measure `containerRef.current` dimensions
- Compute `baseDimensions` to fit the image within the container

**Draw effect (replaces second useEffect):**
- Triggered by `baseDimensions`, `zoom`, `pageImage`, `rawCoords`
- `canvas.width = baseDimensions.width × zoom`, `canvas.height = ...`
- `ctx.drawImage(pageImage, 0, 0, canvas.width, canvas.height)`
- If `rawCoords`: scale from AI 1024×768 space to canvas pixel space:
  ```
  scaleX = canvas.width / 1024
  scaleY = canvas.height / 768
  bx = rawCoords.x1 × scaleX
  by = rawCoords.y1 × scaleY
  bw = (rawCoords.x2 - rawCoords.x1) × scaleX
  bh = (rawCoords.y2 - rawCoords.y1) × scaleY
  ```
  Draw red fill + red stroke rect

**Zoom handlers** (same as `LocationDetailsModal`):
```typescript
const handleZoomIn = () => { setZoom(z => Math.min(4, z + 0.25)); };
const handleZoomOut = () => { setZoom(z => Math.max(0.5, z - 0.25)); };
```

**UI changes:**
- Add a fixed-height toolbar above the drawing area: `[ZoomOut] [50%] [ZoomIn]`
- Add `containerRef` to the scrollable drawing div
- Left panel: add "Bounding Box" row showing `(x1, y1) → (x2, y2)` or "—"

### C. Add `ZoomIn`, `ZoomOut` to lucide-react imports (line 27)

These are not currently imported in `AnalysisSection.tsx`.

---

## Summary of changes

| # | Location | Change |
|---|---|---|
| 1 | Lines 103–175 | Rewrite `parseCoordinatesFromResult` to match `"bounding"/"box"/"bbox"` + parse `(x1,y1,x2,y2)` format + use 1024×768 AI space |
| 2 | Lines 181–335 | Refactor `InstanceDetailModal`: add `zoom`/`baseDimensions`/`pageImage`/`rawCoords` state; render PDF page to offscreen canvas → image → display canvas; draw red bounding box scaled to zoom; add ZoomIn/ZoomOut toolbar; add Bounding Box row in left panel |
| 3 | Line 27 | Add `ZoomIn`, `ZoomOut` to lucide-react imports |

No DB changes. No new packages. No other files.
