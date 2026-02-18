
# 5 Fixes: Zoom (copied from LocationDetailsModal), Bounding Box Accuracy, Stop Clears Spinner, Re-analyze Clears Values, Remove Size Column

## Root cause analysis

### 1. Zoom is broken — InstanceDetailModal doesn't match LocationDetailsModal pattern
The current `InstanceDetailModal` zoom uses a simple `setZoom` increment with no center-preserving scroll logic. `LocationDetailsModal` uses:
- `scrollCenterX/Y` captured before zoom change
- `requestAnimationFrame` after zoom to restore scroll position proportionally
- A `containerRef` that wraps the scrollable area (not attached to the canvas parent)

The current modal also wraps the canvas in `"border rounded-md overflow-auto ... min-h-[300px] max-h-[500px] flex items-start justify-start"`. The `LocationDetailsModal` uses `flex-1 min-w-0 flex flex-col overflow-hidden` for the right panel and a separate scrollable container div. This exact structure must be copied.

Additionally the modal itself uses `max-w-5xl w-full` but no fixed height — meaning the inner container has no real height reference, so `baseDimensions` calc fails. The modal should become `max-w-5xl h-[85vh] flex flex-col p-0` (same as LocationDetailsModal) with a fixed header bar, a split left/right layout, and a scrollable right pane.

### 2. Bounding box is offset — row matching logic or coordinate space issue
From the DB: `SWC-B03` has bounding box `(320, 350, 410, 420)`. The screenshot shows `(190, 540) → (260, 600)`. These are different instances — `SWC-B04` gets `(150, 340, 310, 460)` and `SWC-B03` gets `(320, 350, 410, 420)`. But the screenshot says the modal shows `SWC-B03` with `(190, 540) → (260, 600)`.

Wait — reading the DB result more carefully:
```
Row 1: ELECTRICAL (SWC-B04) | SWC-B04 | ... | (150, 340, 310, 460)
Row 2: SUBSTATION ROOM (SWC-B03) | SWC-B03 | ... | (320, 350, 410, 420)
```

But the screenshot shows `(190, 540) → (260, 600)` for `SWC-B03`. Those coordinates are not in the DB at all. This means the parser is currently reading the **wrong result_text** entirely — possibly reading the wrong row from `analysis_results`, or `resultText` is being passed as `undefined`.

Looking at the parent code (line 1388):
```tsx
const sourceResult = classResults.find((r) => r.result_text?.includes(instance.id));
```
`instance.id` comes from `summarizedInstances[awpClassName]` which is populated by `summarize-analysis` edge function. The `inst.id` is the "Display ID" (e.g., `ERM001`, `ERM002`) — NOT the raw plan ID like `SWC-B03`. So `result_text?.includes("ERM001")` will never match.

**Root fix**: The `summarize-analysis` function should be storing the raw plan ID so we can match it back to the result. But since we can't change that right now, the alternative is to pass the **raw result text** for the entire class (not looking for the instance ID within it), and instead look up the bounding box by scanning all rows and finding the one whose `Room Identifier` or `Room number/tag` column matches `instance.id` (the display ID).

Actually — re-reading the `summarize-analysis` function response: it returns instances with `id` set to the Display ID (e.g., `ERM001`). The `resultText` passed to `parseCoordinatesFromResult` needs to search for `SWC-B03` not `ERM001`. 

**Real fix**: Pass the raw AI result text for the class (not filtered by instance.id match) and instead use the `instance.name` (which contains the raw label like "SUBSTATION ROOM SWC-B03") to extract the plan room code. Or better: pass all result_texts for the class and scan for the bounding box that belongs to the corresponding row.

The cleanest fix: in the `InstanceDetailModal`, instead of matching `instance.id` in `parseCoordinatesFromResult`, try matching `instance.name` (the raw drawing label) OR search for any four-number bounding box tuple in the result text associated with the correct row number (by scanning all rows and picking the one at `idx` position matching the instance's sequential position in the summary).

**Plan**: Change `parseCoordinatesFromResult` to accept a `searchTerm: string[]` (array of terms to try, e.g., `[instance.id, instance.name, planRoomCode]`), and try each. Also try just "first found bounding box" if only one row exists.

Additionally at the parent, the `sourceResult` lookup currently uses `result_text?.includes(instance.id)` — since `instance.id` is `ERM001` and result_text has `SWC-B03`, this never matches. Fix: find the result that is `complete` for that class — since each file has one result per class, find the result for the file that has bounding box data. Use ALL results for the class and combine result_texts, then scan for the name or any recognizable fragment.

### 3. Stop doesn't clear spinners
When `handleStop` is called, `abort()` fires the controller. The inner `fetch` calls throw `AbortError`. The `catch` branch in the file loop checks for `AbortError` and sets `aborted = true` and breaks. The `finally` block calls `setAnalyzingClasses(prev => { next.delete(className); return next; })`. 

But `classFileStatuses[className][file.id]` is still `"processing"` for any file that was mid-flight when aborted. `countForCell` reads `liveStatus === "processing"` → returns `"loading"` → renders spinner. This is why spinners persist.

**Fix**: In `handleStop`, immediately clear all `"processing"` entries for that class:
```typescript
const handleStop = (className: string) => {
  abortControllers.current[className]?.abort();
  // Immediately clear processing status for this class so spinners disappear
  setClassFileStatuses((prev) => {
    const classStatuses = { ...(prev[className] || {}) };
    for (const fileId of Object.keys(classStatuses)) {
      if (classStatuses[fileId] === "processing") {
        delete classStatuses[fileId];
      }
    }
    return { ...prev, [className]: classStatuses };
  });
};
```

### 4. Re-analyze should clear existing values
When `handleAnalyze` is called for a class that already has results, the `summarizedInstances[className]` from the previous run still shows in the summary table, and the old DB results still show counts. 

**Fix**: At the top of `handleAnalyze`, clear `summarizedInstances` and `classFileStatuses` for that class:
```typescript
setSummarizedInstances((prev) => { const next = { ...prev }; delete next[className]; return next; });
setAddedToProject((prev) => { const next = { ...prev }; delete next[className]; return next; });
```

Also clear DB results for this class in the display by clearing `classFileStatuses` for all files to `null` (so `countForCell` reads the fresh DB query after `invalidateQueries`).

### 5. Remove Size column
Remove the `<th>` with "Size" (line 1092-1094) and the matching `<td>` (lines 1178-1181).

---

## Implementation plan — `src/components/analysis/AnalysisSection.tsx` only

### A. Fix `InstanceDetailModal` — adopt full LocationDetailsModal zoom pattern

**Modal structure change**: from `max-w-5xl w-full` with a vertical flex body, to `max-w-5xl h-[85vh] flex flex-col p-0` with:
- A `DialogHeader` that is `px-6 pt-6 pb-4 border-b flex-shrink-0` 
- A body `div` that is `flex-1 flex min-h-0 overflow-hidden`
  - Left panel: `w-56 flex-shrink-0 border-r overflow-y-auto p-6` (info fields)
  - Right panel: `flex-1 min-w-0 flex flex-col overflow-hidden`
    - Fixed header bar: `h-12 flex-shrink-0 flex items-center justify-between px-4 border-b bg-background` (zoom controls + "Drawing Preview" label)
    - Scrollable container: `ref={containerRef}` + `flex-1 overflow-auto` → contains the `<canvas>`

**Zoom handlers** — exact copy from `LocationDetailsModal`:
```typescript
const handleZoomIn = () => {
  const container = containerRef.current;
  if (!container) { setZoom(z => Math.min(4, z + 0.25)); return; }
  const scrollCenterX = container.scrollWidth > 0
    ? (container.scrollLeft + container.clientWidth / 2) / container.scrollWidth : 0.5;
  const scrollCenterY = container.scrollHeight > 0
    ? (container.scrollTop + container.clientHeight / 2) / container.scrollHeight : 0.5;
  setZoom(prevZoom => {
    const newZoom = Math.min(4, prevZoom + 0.25);
    requestAnimationFrame(() => {
      container.scrollLeft = scrollCenterX * container.scrollWidth - container.clientWidth / 2;
      container.scrollTop = scrollCenterY * container.scrollHeight - container.clientHeight / 2;
    });
    return newZoom;
  });
};
const handleZoomOut = () => {
  // mirror of handleZoomIn with Math.max(0.5, prevZoom - 0.25)
};
```

**Base dimensions effect** — trigger on `pageImage` only (not zoom). Use `containerRef.current.getBoundingClientRect()` to get real container size:
```typescript
useEffect(() => {
  if (!pageImage || !containerRef.current) return;
  const rect = containerRef.current.getBoundingClientRect();
  const containerW = rect.width - 32;
  const containerH = rect.height - 32;
  if (containerW <= 0 || containerH <= 0) return;
  const aspect = pageImage.naturalWidth / pageImage.naturalHeight;
  const containerAspect = containerW / containerH;
  let baseW: number, baseH: number;
  if (aspect > containerAspect) { baseW = containerW; baseH = containerW / aspect; }
  else { baseH = containerH; baseW = containerH * aspect; }
  setBaseDimensions({ width: baseW, height: baseH });
  setZoom(1);
}, [pageImage]);
```

**Draw effect** — same as current, triggered by `[pageImage, baseDimensions, zoom, rawCoords]`.

### B. Fix bounding box matching — search by `instance.name` fragments

Change `parseCoordinatesFromResult` to accept multiple search terms:
```typescript
function parseCoordinatesFromResult(
  resultText: string,
  searchTerms: string[]  // try each in order
): { x1, y1, x2, y2, pageNum } | null
```
In the row search loop, try each term:
```typescript
const dataRow = lines.find((l) => {
  const cells = l.split("|").map((c) => c.trim());
  return searchTerms.some(term => 
    cells.some(c => c.includes(term) || term.includes(c))
  );
}) || 
// fallback: first data row that has a bounding box coordinate
lines.slice(headerIdx + 1).find(l => /\(\s*\d+/.test(l));
```

In `InstanceDetailModal`, extract the plan room code from `instance.name` (often "SUBSTATION ROOM SWC-B03" → extract `SWC-B03`):
```typescript
const planCodeMatch = instance.name.match(/\b([A-Z]+-B?\d+)\b/);
const planCode = planCodeMatch?.[1];
const searchTerms = [instance.id, instance.name, planCode].filter(Boolean) as string[];
const coords = parseCoordinatesFromResult(resultText, searchTerms);
```

At the parent (line 1387-1389), fix `resultText` lookup — since `instance.id` is `ERM001` (not in result_text), get ALL complete results for the class and concatenate or just pick the first with result_text:
```typescript
// Changed from:
const sourceResult = classResults.find((r) => r.result_text?.includes(instance.id));
// To:
const sourceResult = 
  classResults.find((r) => r.result_text && r.status === "complete" && 
    (r.result_text.includes(instance.name) || 
     r.result_text.includes(instance.id.replace(/\D+/, '')))) ||
  classResults.find((r) => r.status === "complete" && r.result_text);
```

Also pass `instance.name` to `InstanceDetailModal` so the parser can use it.

Actually the cleanest approach: Since `summarize-analysis` returns instances with IDs like `ERM001` based on sequential numbering, and original AI result text has `SWC-B03`, the only reliable link is `instance.name` (the drawing label). Pass the combined result text from ALL results for the class. Then search `instance.name` fragments.

At parent: compute `combinedResultText` = all complete result texts for that class joined. Pass as `resultText`.

### C. Stop clears spinners — update `handleStop`
Replace lines 746-748 with the version that also clears `"processing"` statuses.

### D. Re-analyze clears values — update `handleAnalyze`
At top of `handleAnalyze`, after creating the abort controller, add:
```typescript
setSummarizedInstances(prev => { const n = {...prev}; delete n[className]; return n; });
setAddedToProject(prev => { const n = {...prev}; delete n[className]; return n; });
```

### E. Remove Size column
- Remove `<th>` for Size (lines 1092-1094)
- Remove `<td>` for Size (lines 1178-1181)  
- Remove `<td className="px-3 py-1.5" />` spacer in the button sub-row (line 1117)

---

## Summary

| Fix | What changes |
|---|---|
| Zoom fix | `InstanceDetailModal` gets full `LocationDetailsModal` layout: `h-[85vh] flex flex-col p-0`, fixed zoom header bar, `flex-1 overflow-auto` scrollable container, center-preserving zoom handlers |
| Bounding box | `parseCoordinatesFromResult` accepts `string[]` search terms; tries `instance.name` fragments; fallback to first row with coordinates; parent passes combined result text + instance name for matching |
| Stop clears spinner | `handleStop` clears `"processing"` entries from `classFileStatuses` immediately on abort |
| Re-analyze clears values | `handleAnalyze` clears `summarizedInstances[className]` and `addedToProject[className]` at start |
| Size column removed | `<th>`, `<td>`, and spacer `<td>` removed |

One file only: `src/components/analysis/AnalysisSection.tsx`. No DB changes, no new packages.
