
# Instance Detail Modal — "View More" per Summary Row

## Overview

Three changes in one file: `src/components/analysis/AnalysisSection.tsx`

1. Remove the **Notes** column from the summary table
2. Add a **View** button (icon) per row that opens an instance detail modal
3. The modal shows: instance details (notes, floor, area), the source drawing as a PDF preview, and a bounding box overlay when coordinate data is parseable from the raw result text

No backend changes, no migrations, no new dependencies. `pdfjs-dist` is already installed.

---

## 1. Remove Notes Column

- Remove `<TableHead>Notes</TableHead>` from the summary table header
- Remove the `<TableCell>` that renders `inst.notes` from each row
- The notes content moves exclusively into the detail modal

---

## 2. "View" Button per Row

Replace the removed Notes cell with a compact action cell containing an `Eye` icon button (ghost variant, `h-7 w-7`). Clicking it sets `selectedInstance` state and opens the modal.

New state added to the component:

```typescript
const [selectedInstance, setSelectedInstance] = useState<{
  instance: SummarizedInstance;
  awpClassName: string;
} | null>(null);
```

---

## 3. Instance Detail Modal

A `Dialog` component renders when `selectedInstance` is set. It closes on the standard X button or clicking outside.

### Modal Layout

```
┌─────────────────────────────────────────────────────┐
│  [AWP Class] — [Display ID]                    [X]  │
├─────────────────────────────────────────────────────┤
│  DETAILS (left column)    │  DRAWING PREVIEW (right) │
│  ─────────────────────    │  ────────────────────── │
│  Name:  ELECTRICAL        │  [PDF page rendered as   │
│  Floor: Lower Level       │   canvas, with bounding  │
│  Area:  285 sqft          │   box overlay if avail]  │
│  Notes: clear label...    │                          │
│                           │  Source: filename.pdf    │
└─────────────────────────────────────────────────────┘
```

### Finding the Source File

When the modal opens, the component searches loaded `results` (already in memory from the `analysis-results` query) for a result whose `result_text` contains the instance's Display ID (the `inst.id` string):

```typescript
const sourceResult = classResults.find(r =>
  r.result_text?.includes(instance.id)
);
const sourceFile = files.find(f => f.id === sourceResult?.file_id);
```

If no match: the modal shows instance details only, with a "Source file not identifiable" note in the preview pane.

### PDF Preview

Uses `pdfjs-dist` (already in the project — used in `FileViewerModal.tsx`). Steps:

1. On modal open (or when `sourceFile` resolves), fetch a signed URL from the storage bucket using `supabase.storage.from("analysis-files").createSignedUrl(storagePath, 60)`
2. Load the PDF with `pdfjsLib.getDocument(signedUrl)`
3. Render page 1 (or whichever page contains the instance — page detection described below) to a `<canvas>` element at a fixed resolution (scale 1.5x)
4. If bounding box coordinates are available, draw an overlay rectangle on the canvas using the Canvas 2D API after page render

### Bounding Box Parsing

The raw `result_text` sometimes includes a "Coordinate on Plan" column. The parser will attempt to extract this:

```typescript
function parseCoordinatesFromResult(resultText: string, instanceId: string): {
  x: number; y: number; w: number; h: number; pageNum: number;
} | null
```

Logic:
- Find the row in the pipe-delimited table where the first cell matches `instanceId`
- Find the column index for "Coordinate" or "Coordinate on Plan"
- Parse the value — expected format: `(x, y)` or `x1,y1 – x2,y2` or similar
- If parseable, return normalized `{x, y, w, h}` as fractions of page dimensions (0–1 range) so they scale with canvas size
- If not parseable or column absent: return `null` (no overlay drawn)

The overlay is drawn as a semi-transparent blue rectangle (`rgba(59, 130, 246, 0.25)`) with a solid blue border (2px), styled to match the app's primary colour.

### Page Detection

The result text sometimes references a "Sheet / Page Reference" column. If parseable and numeric, use that as the page number. Default: page 1.

### Loading State

While the signed URL is being fetched or the PDF is rendering, show a `Loader2` spinner centered in the preview pane.

---

## New Sub-component: `InstanceDetailModal`

Extracted as a separate function component within `AnalysisSection.tsx` for cleanliness:

```typescript
interface InstanceDetailModalProps {
  instance: SummarizedInstance;
  awpClassName: string;
  sourceFile: AnalysisFile | undefined;
  resultText: string | undefined;
  onClose: () => void;
}
```

Internal state: `signedUrl`, `isLoadingPdf`, `pdfError`. The `useEffect` fetches the signed URL when `sourceFile` changes. A second `useEffect` renders the PDF to canvas when `signedUrl` is available.

---

## Imports Added

```typescript
import { Eye } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import * as pdfjsLib from "pdfjs-dist";
```

`pdfjs-dist` worker configuration is already set up in `src/lib/pdfProcessor.ts`. The `InstanceDetailModal` component needs to configure the worker too (or import from `pdfProcessor.ts` — we'll import the existing setup by importing `extractPDFData` from that file to trigger the worker registration, or simply duplicate the two-line worker config since it's idempotent).

---

## Table Structure After Change

**Before:**
| Display ID | Name | Floor | Area (sqft) | Notes |

**After:**
| Display ID | Name | Floor | Area (sqft) | (action) |

The action column has no header text — just the `Eye` icon button per row, right-aligned.

---

## File Change Summary

| File | Changes |
|---|---|
| `src/components/analysis/AnalysisSection.tsx` | Remove Notes column; add `selectedInstance` state; add `Eye` button per row; add `InstanceDetailModal` sub-component with PDF preview + bounding box overlay |

No other files change.

---

## Technical Notes

- The `Dialog` component from `@radix-ui/react-dialog` (already installed via `src/components/ui/dialog.tsx`) handles focus trapping and accessibility correctly
- `pdfjsLib.getDocument` accepts a URL string — the signed URL from storage works directly
- Canvas rendering must happen in a `useEffect` after the canvas `ref` is mounted, after the PDF loads. A `useRef<HTMLCanvasElement>` is used for the canvas element
- If `sourceFile?.storage_path` is null (file not yet copied), the preview pane shows "Drawing not available" gracefully
- The modal is `max-w-4xl` to accommodate the two-column layout; on smaller screens the layout stacks vertically via responsive Tailwind classes (`flex-col md:flex-row`)
- The bounding box overlay is painted with `ctx.strokeRect` + `ctx.fillRect` after `page.render()` completes (the render promise resolves before we draw)
