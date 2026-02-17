

# Redesign Analysis Request Detail Page

## Overview

Three changes to the AnalysisRequestDetail page and AnalysisSection component:

1. Replace file tree with a flat table (columns: File Name, Status, Size) with clickable file names that open a preview/download modal
2. Consolidate the 3 summary cards + download button into a single compact table header
3. Parse analysis results into structured asset instance tables (ID, Name, Level, Size) and show risk points with P x I tooltip on each AWP class header

---

## 1. File List Table + Compact Header

**Remove**: The 3 stat cards (lines 252-266), the standalone Download button section (lines 268-274), and the file tree with `buildFileTree`/`FileTreeItem`.

**Replace with**: A single card with a header row like:

```
Files (Count: 11, 3.4 MB, Procore)                    [Download ZIP]
```

Below the header, a `<Table>` with columns:
- **File Name** (from `relative_path`) -- clickable, opens preview modal
- **Status** -- colored badge
- **Size** -- formatted bytes

## 2. File Preview/Download Modal

When a file name is clicked, open a `<Dialog>`:
- Title: file name
- For images (`mime_type` starts with `image/`): render `<img>` using a signed Supabase storage URL
- For other types: show metadata (mime type, size)
- **Download** button that fetches from `drive-analysis-files` bucket via `supabase.storage.from('drive-analysis-files').download(storage_path)`

## 3. Analysis Results as Parsed Asset Instance Table

The `result_text` from the AI is a pipe/tab-delimited table. Parse it into rows and display as a structured `<Table>` with columns: **ID**, **Name**, **Level**, **Size**.

Mapping from the result columns:
- ID = "Generated Room Code" (e.g., ER001)
- Name = "Drawing Label" (e.g., ELECTRICAL)
- Level = "Building Floor / Level" (e.g., FOURTH FLOOR)
- Size = extracted from "Notes" column (e.g., "103 ft2 / 10 m2")

If no rows are found (the result says "none found" or the table is empty), show "No instances found" message.

## 4. AWP Class Header with Risk Points

For each AWP class (e.g., "Electrical Room"), look up probability and impact from the source tables (`critical_assets`, `water_systems`, `processes`) based on `awp_class_prompts.category`.

Display next to the class name: a badge showing risk points (P x I) with a `<Tooltip>` on hover showing "Probability: X, Impact: Y".

Style risk badges following existing convention:
- Very High (1-15): orange-500
- Extreme (16-20): red-600
- Severe (21-25): red-900

---

## Technical Details

### Files to modify

**1. `src/pages/AnalysisRequestDetail.tsx`**
- Remove `buildFileTree`, `FileTreeNode` interface, `FileTreeItem` component
- Remove the 3-card stats grid (lines 252-266)
- Remove standalone Download section (lines 268-274)
- Replace file card header (line 279) with consolidated header showing count, total size, source + Download ZIP button
- Replace tree rendering with a `<Table>` using `Table, TableBody, TableCell, TableHead, TableHeader, TableRow` from `@/components/ui/table`
- Add `selectedFile` state and a `<Dialog>` for file preview/download
- Import `Dialog, DialogContent, DialogHeader, DialogTitle` from `@/components/ui/dialog`
- Import `Tooltip, TooltipContent, TooltipProvider, TooltipTrigger` from `@/components/ui/tooltip`

**2. `src/components/analysis/AnalysisSection.tsx`**
- Add a query to fetch P x I values from `critical_assets`, `water_systems`, `processes` tables
- In the AWP class header, add a risk points badge with tooltip showing "Probability: X x Impact: Y"
- Add a `parseResultText` utility function that:
  - Splits `result_text` by newlines
  - Detects pipe-delimited or tab-delimited format
  - Extracts header row and data rows
  - Maps columns to ID, Name, Level, Size
  - Returns an array of `{ id, name, level, size }` objects
- Replace the `<pre>` result display with a `<Table>` showing the parsed instances
- If parsing fails or no rows, fall back to showing the raw text in a collapsible section
- Import `Table` components and `Tooltip` components

### New imports needed
- `Table, TableBody, TableCell, TableHead, TableHeader, TableRow` from `@/components/ui/table`
- `Dialog, DialogContent, DialogHeader, DialogTitle` from `@/components/ui/dialog`
- `Tooltip, TooltipContent, TooltipProvider, TooltipTrigger` from `@/components/ui/tooltip`

### No database changes required
