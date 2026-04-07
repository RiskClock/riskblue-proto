

# Use AI-Provided Bounding Box Coordinates for Circle Placement

## Problem

The current circle placement relies entirely on searching the PDF text layer for matching strings. For long labels or substring matches, the found text item may not be centered on the actual detection. Meanwhile, the AI response already includes a **"Bounding Box"** column with pixel coordinates like `(1848, 2665) → (1975, 2681)` — these point directly to where the AI detected the component, but the code ignores them.

## Solution

Parse the AI-provided bounding box coordinates from the result table and use them as the **primary** circle placement method. Fall back to text-layer search only when coordinates aren't available or parseable.

### File: `src/components/analysis/AnalysisSection.tsx`

**1. Extend `OverlayRow` interface** to include optional AI bbox:
```
interface OverlayRow {
  candidates: string[];
  pageNum: number;
  aiBBox?: { x1: number; y1: number; x2: number; y2: number };
}
```

**2. Update `parseOverlayCandidates`** (~line 180):
- Detect a "bounding box" column in headers
- Parse coordinate patterns like `(1848, 2665) → (1975, 2681)` or `(1848, 2665) -> (1975, 2681)` from each row
- Store parsed coordinates in `aiBBox` field

**3. Update `RawResultModal` rendering** (~line 846-900):
- When an `OverlayRow` has `aiBBox`, convert AI pixel coordinates to canvas coordinates directly (scale from AI image dimensions to the rendered canvas size)
- Use `aiBBox` center as circle center, derive radius from bbox dimensions + padding
- Only fall back to `findBBoxInTextLayer` when `aiBBox` is missing

**4. Update `InstanceDetailModal` rendering** (~line 475-600):
- Same logic: prefer `aiBBox` coordinates over text-layer search
- Compute circle center from AI bbox center point

**5. AI coordinate → canvas coordinate mapping**:
- The AI bounding box coordinates are in the original image pixel space (the image sent to OpenAI)
- The PDF page is rendered at a known scale; we need to map AI coords → PDF user-space → viewport → canvas
- Since both AI and our renderer see the same page image, the mapping is: `canvasX = (aiBBox.x / aiImageWidth) * canvasWidth`
- The AI image dimensions can be inferred from the PDF page dimensions at the rendering scale used during upload

## Files Changed

| File | Change |
|---|---|
| `src/components/analysis/AnalysisSection.tsx` | Parse bounding box column from AI result table; use AI coordinates as primary circle placement; fall back to text-layer search when unavailable |

