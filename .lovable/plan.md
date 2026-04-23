# Refactor drawing modals to a shared, library-based viewer

## Guiding principles
- **Preserve product behavior**: do not change any modal's UX as part of this refactor. Behavior changes (e.g., RawResultModal page-by-page) are deferred decisions.
- **Transform state is the single source of truth**: pan/zoom state lives in `react-zoom-pan-pinch`. No `scrollLeft`/`scrollTop` navigation model. No modal-owned anchoring math after migration.
- **Adaptive PDF raster**: CSS transform during interaction; reraster only after transform settles, only for PDF sources, with capped DPR + total pixel budget.
- **Overlays in document coordinates**: overlays live inside the transformed surface so geometric alignment holds across zoom/pan (not pixel-perfect at every scale, but geometrically correct).
- **Centralized coordinate normalization**: 0..1 normalized, PDF-point, and page-indexed overlays handled in shared utilities — never in modals.
- **Delete `useMapNavigation` only after** all consumers are migrated.

## Goal
Replace the custom scroll-based zoom/pan implementation (`useMapNavigation`) across all drawing modals with a single shared viewer built on `react-zoom-pan-pinch` + `pdfjs`. Eliminate per-zoom PDF rerasterization, share overlay/fit-to-selection logic, and make UX consistent — without changing per-modal behavior in this pass.

## Scope: modals to migrate
1. `FileViewerModal` (wizard) — multi-page PDF + overlays — **migrate first** (highest visible interaction pain)
2. `InstanceDetailModal` (in `AnalysisSection.tsx`) — selection/fit-to-bbox
3. `LocationDetailsModal` (wizard) — selection/fit-to-bbox
4. `RawResultModal` (in `AnalysisSection.tsx`) — split-pane source PDF + AI text; **keep stacked-pages behavior** initially
5. `FilePreviewModal` (in `AnalysisSection.tsx`) — simple file preview

## Shared architecture

```text
src/components/viewer/
  DrawingViewer.tsx       <-- shell: TransformWrapper + toolbar + overlays; supports single-page OR stacked-pages mode
  DocumentSurface.tsx     <-- pdfjs raster OR <img>; adaptive reraster on settle
  OverlayLayer.tsx        <-- bboxes/labels in document/page coordinates; lives inside TransformComponent
  ViewerToolbar.tsx       <-- zoom in/out, reset, fit page, fit selection, page nav
  hooks/
    useDocumentSource.ts  <-- unify Drive / Supabase (uploaded-drawings vs drive-analysis-files) / blob URL loading
    usePdfPageRaster.ts   <-- base raster; settle-based high-DPI reraster with capped budget
    useFitToSelection.ts  <-- compute transform from a target bbox via the rzpp API
  viewerGeometry.ts       <-- bbox normalization (0..1, PDF points, page-indexed) + transform math
```

### `DrawingViewer` API
```ts
<DrawingViewer
  source={{ kind: 'pdf' | 'image', blob | url, accessToken? }}
  layout="single-page" | "stacked-pages"   // preserves RawResultModal behavior
  page?={1}                                 // single-page mode
  overlays={[{ id, bbox, page?, coordSpace: 'normalized' | 'pdf-points', color, label }]}
  selection?={bboxId | bbox}                // drives fit-to-selection
  initialFit="page" | "selection" | "actual"
  minScale={0.5} maxScale={8}
  toolbar={{ pageNav, fit, zoomButtons }}
  onReady={(api) => ...}                    // exposes zoomTo, fitToBox, getTransform
/>
```

### Adaptive raster strategy (PDF only)
- One base raster per page at a moderate scale (e.g., devicePixelRatio-aware base).
- During wheel/pinch/drag: **no reraster**, CSS transform only.
- After `onTransformed` quiet period (~250ms) AND scale exceeds a threshold: reraster the visible page(s) at higher DPI.
- Cap requested resolution by:
  - max effective DPR (e.g., 3)
  - max total pixel budget per page (e.g., 16M px)
  - skip reraster entirely if computed size exceeds budget
- Image sources: never reraster.

### State model
- All pan/zoom comes from `react-zoom-pan-pinch` transform state.
- No modal reads or writes `scrollLeft`/`scrollTop`.
- Fit-to-selection computes a target `{x, y, scale}` and calls the rzpp API (`setTransform`/`zoomToElement`).

### Overlay alignment
- Overlays declared in document coordinates (normalized 0..1 OR PDF points + page index).
- Rendered as absolutely-positioned elements inside `TransformComponent` so they share the same transform as the page.
- Acceptance is **geometric alignment** across zoom/pan — not pixel-perfect at every scale.

## Per-modal migration (behavior-preserving)

| Modal | Layout mode | Selection | Notes |
|---|---|---|---|
| FileViewerModal | single-page (current) | n/a | Toolbar gets page chevrons; first migration target |
| InstanceDetailModal | single-page | yes | Preserve "fit selection" auto-zoom behavior |
| LocationDetailsModal | single-page | yes | Preserve detection bbox initial fit |
| RawResultModal | **stacked-pages** | n/a | Preserve current stacked behavior; only the PDF pane uses `DrawingViewer` |
| FilePreviewModal | single-page or image | n/a | Source kind switches `pdf` vs `image` |

## Migration order
1. Build shared viewer (`DrawingViewer`, `DocumentSurface`, `OverlayLayer`, `ViewerToolbar`, hooks, geometry utils). Add `react-zoom-pan-pinch`.
2. Migrate **FileViewerModal** (highest interaction pain) — validate base viewer, raster strategy, page nav.
3. Migrate **InstanceDetailModal** — validate selection-fit + overlays.
4. Migrate **LocationDetailsModal** — same selection-fit path.
5. Migrate **RawResultModal** in `stacked-pages` mode — preserve current UX.
6. Migrate **FilePreviewModal**.
7. Verify zero remaining consumers, then delete `useMapNavigation.ts` and remove modal-local bbox/zoom math.

## Acceptance criteria
- All target modals render through `DrawingViewer`.
- No modal owns wheel/drag/scroll math; transform state is owned by rzpp.
- Wheel + trackpad pinch + drag-pan feel smooth on mouse and trackpad.
- Overlays remain **geometrically aligned** with the underlying document during zoom/pan.
- No PDF rerasterization on every zoom tick; reraster occurs only after settle and within DPR/pixel budget.
- Bbox normalization and fit-to-selection logic are centralized in shared utilities.
- Current per-modal behavior preserved (incl. RawResultModal stacked pages).
- `useMapNavigation` removed only after the last consumer is migrated.
