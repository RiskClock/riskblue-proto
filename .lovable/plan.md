
# All 7 Fixes: Drawing Preview, AWP Ordering/Prefix, Grid Width, Clickable Files, Header Labels, Remove Files Section, Column Lock

## Files changed
1. `src/components/analysis/AnalysisSection.tsx` — drawing fix, AWP ordering + correct prefix, clickable filenames + FilePreviewModal, File Name header labels, first-column width lock
2. `src/pages/AnalysisRequestDetail.tsx` — widen to max-w-7xl, remove Files collapsible section + file preview modal + unused state/effects

---

## Fix 1: Drawing "Failed to render drawing" — root cause confirmed

The `InstanceDetailModal` (lines 195–334) still uses **`createSignedUrl` + string URL** passed to `pdfjsLib.getDocument(signedUrl)`. PDF.js makes a network request for that URL using byte-range headers which Supabase Storage CDN rejects, causing the render to fail.

The working pattern (already used in `AnalysisRequestDetail.tsx` lines 155–196) is `.download()` → blob → `ArrayBuffer` → `getDocument({ data: arrayBuffer })`.

**Changes to `InstanceDetailModal`:**
- Replace state `signedUrl: string | null` with `pdfArrayBuffer: ArrayBuffer | null`
- Replace the first `useEffect` (lines 200–217): call `.download(sourceFile.storage_path)` → `.arrayBuffer()` → `setPdfArrayBuffer(ab)`
- Replace the second `useEffect` dependency `signedUrl` with `pdfArrayBuffer`, and change `getDocument(signedUrl)` to `getDocument({ data: pdfArrayBuffer })`

This mirrors exactly what `AnalysisRequestDetail.tsx` does and is known to work.

---

## Fix 2: AWP ordering matches Configuration page + correct ID prefix

**Current problem**: Prompts are fetched `order("awp_class_name")` (alphabetical). The `idPrefixMap` is built from `awp_classes` table which may have timing issues and doesn't guarantee the same order as the Configuration page.

**Confirmed source-of-truth order** (from DB):

Critical Assets (display_order 1–9): ERM, ELVP, STE, MRM, ERS, MRS, MTM, FEER, KW

Water Systems (display_order 1–6): TWR, HYD, FS, SPSDD, DHW, DCW

Processes (display_order 1–4): CONT, WMVP, MCP, ENGP

**Fix**: Add a new query `awpOrderData` that fetches `name, id_prefix, display_order` from all three source tables in parallel (same as the `useAWPOptions` hook pattern). Build a `globalOrderMap: Record<name, number>` (assets = 0+i, water systems = 1000+i, processes = 2000+i) and a `sourcePrefixMap: Record<name, string>`. Then:

1. Replace `idPrefixMap` (built from `awp_classes`) with `sourcePrefixMap` (built from source tables) — this ensures the correct prefix (e.g., "ERM" not "ELE") even before the `awp_classes` query returns
2. Sort `prompts` by `globalOrderMap` before rendering — this makes both the grid columns and the Analysis Summary rows match Configuration page order

**The fallback** `prompt.awp_class_name.slice(0, 3).toUpperCase()` at line 876 and `className.slice(0, 3).toUpperCase()` at line 1046 are replaced by `sourcePrefixMap[className] || idPrefixMap[className] || "???"` — so if a name is in either map it gets the right abbreviation.

---

## Fix 3: Clickable file names open a FilePreviewModal

Add new state: `const [previewFile, setPreviewFile] = useState<AnalysisFile | null>(null);`

Change the file name `<span>` (line 948–950) to a `<button>` that sets `previewFile`. This button uses the same styling pattern as the existing file preview in `AnalysisRequestDetail`.

Add a new `FilePreviewModal` component (between `RawResultModal` and `parseResultText`) that:
- Accepts `file: AnalysisFile`, `sourceType: string`, `onClose: () => void`
- Downloads the blob from `supabase.storage.from("drive-analysis-files").download(file.storage_path)` 
- Renders all PDF pages using the same canvas loop pattern as `AnalysisRequestDetail.tsx` lines 166–184
- Shows in a `Dialog` with `max-w-4xl` width

Add `sourceType?: string` to `AnalysisSectionProps` and pass `request?.source_type` from `AnalysisRequestDetail.tsx`.

---

## Fix 4: "File Name" header — add count, size, source sub-labels

Change the sticky `<th>` (lines 865–867) from just "File Name" to:

```tsx
<th className="sticky left-0 z-10 bg-card px-4 py-2 text-left font-medium text-muted-foreground min-w-[320px] border-r">
  <span className="block text-sm">File Name</span>
  <span className="block text-xs font-normal text-muted-foreground/70">
    {copiedFiles.length} files · {formatBytes(totalSizeBytes)} · {sourceLabel}
  </span>
</th>
```

`totalSizeBytes` = `copiedFiles.reduce((sum, f) => sum + (f.size_bytes || 0), 0)`. `sourceLabel` = `sourceType?.replace("_", " ") || "google drive"`.

---

## Fix 5: Remove "Files" collapsible section from AnalysisRequestDetail

Remove from `AnalysisRequestDetail.tsx`:
- State: `filesCollapsed`, `selectedFile`, `downloadingFile`, `downloadingZip`, `pdfPages`, `pdfLoading`, `pdfPageCount`, `pdfContainerRef`
- Both `useEffect` hooks for PDF loading and canvas rendering (lines 139–212)
- `handleDownloadZip`, `handleDownloadFile`, `getFilePreviewUrl` functions
- The entire Files collapsible section `<div>` (lines 323–389)
- The File Preview `<Dialog>` at the bottom (lines 406–473)
- Remove unused imports: `ChevronDown`, `ChevronRight`, `pdfjsLib`, `Table*`, `Dialog*`, `Download` (if unused after), `useRef`, `useCallback`

Keep: The `AnalysisSection` call and the error message block.

---

## Fix 6: Widen the page

Line 298: `max-w-4xl` → `max-w-[1400px]` (wider than 7xl=1280px for full grid visibility)

---

## Fix 7: First-column width consistency

Both the Download ZIP sub-row `<td>` and every file body `<td>` in the sticky first column get explicit `min-w-[320px]` to guarantee the column never changes width as rows render.

Current `<td>` at line 887: add `min-w-[320px]` class.
Current `<td>` at line 945: add `min-w-[320px]` class.

---

## Technical implementation summary

| # | File | Lines affected | Change |
|---|---|---|---|
| 1 | AnalysisSection.tsx | 195–270 | Blob download in InstanceDetailModal |
| 2 | AnalysisSection.tsx | 478–521 | Add awpOrderData query; build sourcePrefixMap + sortedPrompts |
| 3 | AnalysisSection.tsx | 872–882, 1044–1046 | Use sourcePrefixMap for column headers + summary prefix |
| 4 | AnalysisSection.tsx | 478–486 | prompts → sortedPrompts (sorted by globalOrderMap) |
| 5 | AnalysisSection.tsx | 945–954 | span → button for clickable filename |
| 6 | AnalysisSection.tsx | 92–96 | Add sourceType? prop |
| 7 | AnalysisSection.tsx | 336–364 | Add FilePreviewModal component |
| 8 | AnalysisSection.tsx | 865–867 | File Name header with count/size/source |
| 9 | AnalysisSection.tsx | 887, 945 | min-w-[320px] on sticky first column tds |
| 10 | AnalysisRequestDetail.tsx | 298 | max-w-4xl → max-w-[1400px] |
| 11 | AnalysisRequestDetail.tsx | 93–100, 139–212, 214–274, 323–389, 406–473 | Remove Files section + state + effects + modal |
| 12 | AnalysisRequestDetail.tsx | 399–401 | Pass sourceType prop to AnalysisSection |

No new packages. No DB migrations. No other files.
