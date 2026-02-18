
# Three Changes: PDF User-Space Bounding Boxes · Drawing Tag as ID · Save/Load Summary

## Current state of the code

### Bounding box (lines 260-343)
The load effect renders the PDF page via `page.getViewport({ scale: 4 })` and stores the resulting `HTMLImageElement` in `pageImage`. But the **viewport object itself is discarded** — it's never stored in state. The draw effect (lines 330-342) then uses:
```typescript
const scaleX = w / 1024;
const scaleY = h / 768;
```
This is the hardcoded space the AI no longer uses (prompt has been updated). The correct transform is `viewport.convertToViewportRectangle([x1, y1, x2, y2])`, which handles scale AND Y-axis flip from PDF bottom-left origin to canvas top-left. Since the viewport was rendered at `scale: 4`, its output is in offscreen pixel space. We then normalize by `offscreenSize` (the offscreen canvas dimensions) and multiply by the display canvas size.

### Display ID (summarize-analysis/index.ts line 143)
```json
"id": { "type": "string", "description": "Generated room/asset code (e.g., ER001, MRM001)" }
```
This tells the AI to fabricate a code. The table header reads "Display ID" and shows `inst.id`. It should show the plan tag (`SWC-B03`).

### Summary persistence (lines 839-856)
Every page mount triggers `handleSummarize()` for every class with complete results, calling the AI each time. There is no `summary_data` column on `analysis_requests` (confirmed from schema). Need to add it and wire save/load.

---

## Changes

### 1. Database migration
Add `summary_data jsonb DEFAULT '{}'::jsonb` to `analysis_requests`.

### 2. `supabase/functions/summarize-analysis/index.ts` — line 143
Change:
```
"id": { "type": "string", "description": "Generated room/asset code (e.g., ER001, MRM001)" }
```
To:
```
"id": { "type": "string", "description": "The exact plan tag or room identifier as it appears on the drawing (e.g., SWC-B03, SWC-703, ER-101). Use the identifier from the drawing, NOT a generated sequential code." }
```

### 3. `src/components/analysis/AnalysisSection.tsx`

#### A. Store pdf.js viewport in state (load effect, lines 259-282)
Add two new state variables to `InstanceDetailModal`:
```typescript
const [pdfViewport, setPdfViewport] = useState<pdfjsLib.PageViewport | null>(null);
const [offscreenSize, setOffscreenSize] = useState<{ w: number; h: number } | null>(null);
```
After `const viewport = page.getViewport({ scale: 4 })` (line 268), add:
```typescript
setPdfViewport(viewport);
setOffscreenSize({ w: viewport.width, h: viewport.height });
```
Also reset these in the cleanup at the top of the effect (alongside `setPageImage(null)` etc.).

Add both to the draw effect dependency array.

#### B. Replace hardcoded 1024×768 with viewport.convertToViewportRectangle (lines 330-343)
Replace:
```typescript
if (rawCoords) {
  const scaleX = w / 1024;
  const scaleY = h / 768;
  const bx = rawCoords.x1 * scaleX;
  ...
}
```
With:
```typescript
if (rawCoords && pdfViewport && offscreenSize) {
  // Convert PDF user-space (pts, origin bottom-left) → offscreen canvas pixels
  // viewport.convertToViewportRectangle handles Y-flip and scale in one step
  const [vx1, vy1, vx2, vy2] = pdfViewport.convertToViewportRectangle([
    rawCoords.x1, rawCoords.y1, rawCoords.x2, rawCoords.y2,
  ]);
  // Normalize to [0..1] using offscreen canvas size, then apply to display canvas
  const nx1 = Math.min(vx1, vx2) / offscreenSize.w;
  const ny1 = Math.min(vy1, vy2) / offscreenSize.h;
  const nx2 = Math.max(vx1, vx2) / offscreenSize.w;
  const ny2 = Math.max(vy1, vy2) / offscreenSize.h;
  const bx = nx1 * w;
  const by = ny1 * h;
  const bw = (nx2 - nx1) * w;
  const bh = (ny2 - ny1) * h;
  ctx.fillStyle = "rgba(239, 68, 68, 0.15)";
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = "rgba(239, 68, 68, 0.9)";
  ctx.lineWidth = 2.5;
  ctx.strokeRect(bx, by, bw, bh);
}
```

#### C. Summary persistence — new query + hydrate effect + save after summarize + clear on re-analyze

**New query** (after the existing `results` query at line 721):
```typescript
const { data: savedSummaryData, refetch: refetchSummary } = useQuery({
  queryKey: ["analysis-request-summary", requestId],
  queryFn: async () => {
    const { data } = await supabase
      .from("analysis_requests")
      .select("summary_data")
      .eq("id", requestId)
      .single();
    return (data?.summary_data as Record<string, SummarizedInstance[]>) || {};
  },
});
```

**Replace auto-summarize effect** (lines 839-856) with a DB-hydration effect:
```typescript
useEffect(() => {
  if (!savedSummaryData) return;
  setSummarizedInstances((prev) => {
    const merged = { ...prev };
    for (const [className, instances] of Object.entries(savedSummaryData)) {
      if (!merged[className]) merged[className] = instances as SummarizedInstance[];
    }
    return merged;
  });
}, [savedSummaryData]);
```
This loads saved summaries on mount without calling the AI. The AI is only called after a fresh analysis completes (existing call at line 963).

**Save after summarize** — update `handleSummarize` (lines 824-826):
```typescript
if (data?.instances) {
  setSummarizedInstances((prev) => ({ ...prev, [awpClassName]: data.instances }));
  // Persist to DB so it survives page reloads
  const { data: req } = await supabase
    .from("analysis_requests")
    .select("summary_data")
    .eq("id", requestId)
    .single();
  const existing = (req?.summary_data as Record<string, unknown>) || {};
  await supabase
    .from("analysis_requests")
    .update({ summary_data: { ...existing, [awpClassName]: data.instances } })
    .eq("id", requestId);
  await refetchSummary();
}
```

**Clear on re-analyze** — in `handleAnalyze` after clearing local state (line 863-864), also clear from DB:
```typescript
// Clear saved summary for this class from DB
const { data: req } = await supabase
  .from("analysis_requests")
  .select("summary_data")
  .eq("id", requestId)
  .single();
const existingSum = (req?.summary_data as Record<string, unknown>) || {};
delete existingSum[className];
await supabase
  .from("analysis_requests")
  .update({ summary_data: existingSum })
  .eq("id", requestId);
```

---

## Summary

| # | Problem | Fix |
|---|---|---|
| 1 | Bounding box wrong position | Store `pdfViewport` + `offscreenSize` during PDF render; replace `w/1024` math with `viewport.convertToViewportRectangle(...)` + normalize |
| 2 | Display ID shows `ER001` not `SWC-B03` | Update `summarize-analysis` tool schema: `id` = exact plan tag from drawing |
| 3 | Summary re-runs AI on every page load | Add `summary_data jsonb` to `analysis_requests`; save after summarize; hydrate from DB on mount; skip re-call |

**Files**: `src/components/analysis/AnalysisSection.tsx`, `supabase/functions/summarize-analysis/index.ts`, + 1 DB migration. No new packages.
