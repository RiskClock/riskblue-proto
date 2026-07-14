## Goal

Let users rotate a drawing page in 90° increments in the drawing modal. Save the rotation per page. Show it wherever else the drawing is rendered (threat report preview + download, docx export). The "download original file" path is left untouched.

## 1. Schema

Add a per-page rotation column on `analysis_request_files`:

- `page_rotations jsonb NOT NULL DEFAULT '{}'::jsonb`
  Shape: `{ "1": 90, "3": 270 }`. Missing entries → 0. Values constrained to `{0,90,180,270}` in application code.

No new grants/policies needed — existing table policies already cover it.

## 2. Viewer core (rotation-aware)

`src/components/viewer/DrawingViewer.tsx`

- Add prop `rotation?: 0 | 90 | 180 | 270` (default `0`).
- Compute an "effective page size" by swapping w/h when rotation is 90/270 for `pageCssSize`, fit math, `getVisibleRect`, and `computeFitToRect`. All existing pan/zoom math keeps working because it operates on the rotated CSS box.
- Pass rotation down to `DocumentSurface`.

`src/components/viewer/DocumentSurface.tsx`

- New `rotation` prop.
- The outer wrapper uses the rotated pageSize (as passed in).
- The `<img>` is rendered in an inner absolutely-positioned box sized to the *unrotated* dimensions and transformed with `rotate(<r>deg)` around the center. That places the rotated image exactly inside the outer box.
- Add a rotation-aware inner border overlay for the "glow" indicator when `rotation !== 0`, colored `#6C3BAA` with a soft outer/inner shadow.
- `onCanvasClick` translates the raw normalized coords in the rotated box back to source-page coords before calling the caller.
- Editor bbox coords are similarly transformed both ways (source ↔ rotated) so the editor stays anchored to the correct region.

`src/components/viewer/OverlayLayer.tsx` (and callers)

- Rotate every overlay's normalized rect from source-space into rotated-space before running the existing label layout. Labels therefore render upright automatically because the layout algorithm sees the rotated rect and picks positions on top of the rotated page.
- Rect corner math:
  - 90 CW: `(nx,ny,nw,nh) → (1-ny-nh, nx, nh, nw)`
  - 180  : `(nx,ny,nw,nh) → (1-nx-nw, 1-ny-nh, nw, nh)`
  - 270 CW: `(nx,ny,nw,nh) → (ny, 1-nx-nw, nh, nw)`
- Drag callbacks reverse-map coordinates back to source-space before invoking the caller — persisted instance positions stay in source-page coords.

### 2a. Edit-state inputs stay upright (addresses Q1)

Any interactive edit surface that renders on top of the rotated page must be rendered in the **rotated (screen-upright) coordinate space**, not counter-rotated inside the source frame:

- **Editor bbox handles** (`DocumentSurface`): the editor bbox stored in props is treated as *source-space* coords. Internally, DocumentSurface rotates the bbox into rotated-space using the helper before rendering handles, so the dashed border, corner handles, cursor semantics (nw-resize, etc.), and drag math all operate in normal upright screen space. On drag, the new rotated-space rect is inverse-rotated back to source-space before firing `onEditorBboxChange`. Handle cursors are remapped per rotation (a "nw-resize" corner in source space becomes "ne/sw/se" on screen depending on angle) so the resize cursor matches what the user sees.
- **Annotation metadata popover** (`AnnotationMetadataPopover` in `FileViewerModal`): the popover is positioned using the rotated on-screen anchor of its marker, and its content is not transformed at all — it inherits the modal's normal upright layout. No CSS `rotate()` is applied to the popover, so inputs, tab order, IME, spellcheck, and text selection all behave normally.
- **Inline text edits on plans** (name inputs, `Input` components inside the tab list): these live in the sidebar / popover overlays, not on the transformed surface, so they are unaffected by rotation by design.
- Rule: nothing under the `TransformWrapper` may carry text-input focus. All inputs render in the modal's normal DOM flow with computed positions.

## 3. Toolbar + modal wiring

`src/components/viewer/ViewerToolbar.tsx`

- New optional props: `rotation`, `onRotate`.
- New button placed between the fit/download button and Fit Detection (i.e. between reset/fit and the download slot as requested). Icon: `RotateCw`. When `rotation !== 0`, the button uses `#6C3BAA` foreground/border.

`src/components/wizard/FileViewerModal.tsx`

- Load `page_rotations` when the modal opens (from the already-fetched file row or a lightweight fetch keyed off `fileId`).
- Local state `rotationByPage: Record<number, 0|90|180|270>` seeded from DB.
- `onRotate` bumps current page's rotation by 90 (mod 360), updates state, schedules a persist, and passes `rotation` to `<DrawingViewer>`.
- Container div around DrawingViewer gets an inset ring/glow using `#6C3BAA` when the current page is rotated.

### 3a. Persist lifecycle & debounce race (addresses Q2)

Implementation shape for the persist layer inside `FileViewerModal`:

```
const dirtyRef = useRef(false);
const timerRef = useRef<number | null>(null);
const latestRef = useRef<Record<number, 0|90|180|270>>({});

// on rotate click:
latestRef.current = next;
dirtyRef.current = true;
setRotationByPage(next);
if (timerRef.current) window.clearTimeout(timerRef.current);
timerRef.current = window.setTimeout(flush, 500);

// flush = single async writer; awaits DB, clears dirty flag on success
async function flush() { … supabase.update(...); dirtyRef.current = false; }
```

Race handling:

- **On modal close (`onClose` handler)**: cancel the pending timer, then `await flush()` before invoking the parent's close callback. The close is intentionally awaited so the user sees the modal stay open (< 300 ms) if the network write is in flight; the existing "Close" button becomes disabled while `flushing` is true to prevent double-clicks.
- **On unmount cleanup (`useEffect` return)**: if `dirtyRef.current` is true (e.g. modal killed by parent state change without going through `onClose`), fire `flush()` inside the cleanup **without awaiting** and also enqueue the same payload to `navigator.sendBeacon`-style fallback via `supabase.from(...).update(...)` (which is fire-and-forget); we rely on the awaited-close path as the primary guarantee and treat unmount as best-effort.
- **On `beforeunload`**: register a listener while dirty; call `flush()` synchronously via `fetch(..., { keepalive: true })` against the PostgREST endpoint using the anon key + auth JWT so the write survives tab close.
- Rotations are idempotent (same payload = same result), so a duplicate write from an unmount cleanup + a re-open flush is harmless.

## 4. Coordinate helpers & drift guards (addresses Q3)

Single helper module in `viewerGeometry.ts`:

```
rotateNormalizedRect(rect, rotation): NormalizedRect
inverseRotateNormalizedRect(rect, rotation): NormalizedRect
rotateNormalizedPoint(pt, rotation): {nx, ny}
inverseRotateNormalizedPoint(pt, rotation): {nx, ny}
```

Guards baked into every helper:

- **Clamp** every returned `nx, ny, nw, nh` with `Math.min(1, Math.max(0, v))`; for widths/heights additionally clamp so `nx + nw <= 1` and `ny + nh <= 1`.
- **Rounding guard**: quantize outputs to 6 decimal places (`Math.round(v * 1e6) / 1e6`). Six decimals is far below one CSS pixel at any realistic zoom but eliminates the "…9999999" tails that make repeated round-trips creep.
- **Round-trip identity test** (unit test): for every rotation ∈ {0,90,180,270} and 1000 random rects, `inverseRotate(rotate(rect)) === rect` within 1e-6. Added as a Vitest so future refactors can't regress.
- Drag callbacks in `OverlayLayer` and `DocumentSurface` always compute the *new rotated-space rect first*, clamp/quantize, then inverse-rotate back to source-space so the persisted source-space value is also clamped/quantized. This prevents "creep across many drags" because each drag re-emits from freshly-clamped values, not accumulated deltas.

## 5. Threat report

`src/lib/threatReportPageCapture.ts`, `src/lib/pdfPageOverlayExport.ts`, `src/lib/threatReportExport.ts`, `src/components/reports/WaterRiskReport.tsx`

- Fetch `page_rotations` alongside the pages already loaded for the report.
- Pass `rotation` into every `<DrawingViewer>` used by the preview (renders with upright labels thanks to §2).
- Capture path bakes the rotation into the rasterized page image before overlays render (the DOM already contains the rotated image and upright labels, so the html2canvas / snapshot capture picks it up as-is with no extra work).

## 6. Docx export

`src/lib/analysisDocxExporter.ts`

- Read `page_rotations` for each file.
- When rasterizing each page for docx embedding, rotate the resulting canvas by the stored angle before drawing overlays with upright labels using the same rotation-aware overlay path used in the viewer.

### 6a. Portrait ↔ Landscape section switching (addresses Q4)

The docx exporter currently emits every drawing image into a single US-Letter portrait section (content width 9,360 DXA / 6.5 in). For a portrait source page rotated 90°/270° the rasterized canvas is now wider than tall, and squishing it into a 6.5 in-wide column wastes ~40 % of the printable area.

Approach:

- **Per-page aspect check** at export time: compute `aspect = renderedWidth / renderedHeight` *after* rotation. If `aspect > 1` (i.e. landscape after rotation), that page is emitted inside its own docx `Section` with `orientation: PageOrientation.LANDSCAPE` and portrait dimensions passed to docx-js (short edge as width, long edge as height, per the docx skill guidance). Content width becomes 13,680 DXA / 9.5 in.
- **Section boundaries**: wrap each drawing (image + its caption/table) in its own section with `type: SectionType.NEXT_PAGE`, so orientation can flip freely without polluting neighboring pages. Non-drawing sections (summary, controls tables, etc.) stay in the existing portrait section.
- **Image sizing**: compute the target `ImageRun.transformation` from the section's content width, so both portrait- and landscape-oriented images fill the available width without upscaling past the source raster's native pixel size (avoids blurry images from over-enlargement).
- **Caption/table layout under the image** stays portrait-column-width for consistency; on a landscape page the table uses the landscape content width, which reads fine.
- **Fallback**: if a page's aspect is within ±5 % of 1 (near-square), keep portrait to avoid gratuitous orientation changes.

## 7. Out of scope

- Original-file download path (`onDownload` in FileViewerModal that streams the source PDF as-is) — keep as is; the file stays in its native orientation and labels are not applied there.
- Rotation UI anywhere other than the drawing modal.
- Per-user rotation preference (this is a shared, saved state per file/page).

## Files touched

- New migration `supabase/migrations/<ts>_page_rotations.sql`
- `src/components/viewer/DrawingViewer.tsx`
- `src/components/viewer/DocumentSurface.tsx`
- `src/components/viewer/OverlayLayer.tsx`
- `src/components/viewer/ViewerToolbar.tsx`
- `src/components/viewer/viewerGeometry.ts` (rotation helpers + guards)
- `src/components/viewer/__tests__/rotation.test.ts` (new — round-trip identity)
- `src/components/wizard/FileViewerModal.tsx`
- `src/components/reports/WaterRiskReport.tsx`
- `src/lib/threatReportPageCapture.ts`
- `src/lib/threatReportExport.ts`
- `src/lib/pdfPageOverlayExport.ts`
- `src/lib/analysisDocxExporter.ts`
