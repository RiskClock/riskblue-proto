

# Auto-Summarize Analysis Results and Add to Project

## Overview

Three changes:

1. **Fix result parsing** -- the parser assumes line 0 is the header, but AI output has preamble text; scan for the actual pipe-delimited header row
2. **Auto-summarize after analysis completes** -- after all files are analyzed for an AWP class, automatically call an edge function that uses Lovable AI to consolidate all per-file results into a deduplicated instance list
3. **Add to Project button** -- lets internal users insert the summarized instances into `project_analysis_items` for the linked project
4. **PDF preview in file modal** -- render PDF pages using pdfjs-dist when a PDF file is clicked

---

## 1. Fix Result Parsing

**File: `src/components/analysis/AnalysisSection.tsx`**

The `parseResultText` function currently assumes line 0 is the header. But the AI output has preamble like "File Name: A2.01.pdf" and "Table of identified Electrical Rooms:" before the actual table.

**Fix**: Scan all lines to find the first line with 3+ pipe characters AND containing a known header keyword ("Room Code", "Drawing Label", "Floor", "Level", "Notes"). Use that as the header row. Skip separator rows and "Headers:" / "Rows:" labels.

## 2. New Edge Function: `summarize-analysis`

**File: `supabase/functions/summarize-analysis/index.ts`**

- Accepts `analysisRequestId` and `awpClassName`
- Fetches all `analysis_results` with status "complete" for that request + class
- Concatenates all `result_text` values
- Calls Lovable AI (google/gemini-2.5-flash) with a prompt to:
  - Parse the pipe-delimited tables from each file
  - Deduplicate instances across files (same room on different sheets should appear once)
  - Return a JSON array via tool calling with fields: `id` (generated code), `name` (label), `floor`, `area_sqft`, `notes`
- Returns the consolidated list

Uses `LOVABLE_API_KEY` (already configured) and the Lovable AI gateway.

## 3. Auto-Summarize After Analysis + Add to Project

**File: `src/components/analysis/AnalysisSection.tsx`**

After `handleAnalyze` completes (all files processed), automatically call the `summarize-analysis` edge function. Store the summarized instances in component state keyed by AWP class name.

Display the summarized list in a table (ID, Name, Floor, Area, Notes) below the raw parsed results.

Add an **"Add to Project"** button that:
- Looks up the AWP class from the source tables (`critical_assets`, `water_systems`, `processes`) to get `id` and `id_prefix`
- Generates proper `item_id` values using `id_prefix` + sequential number (e.g., ERM001, ERM002)
- Inserts rows into `project_analysis_items` with:
  - `project_id`: from the analysis request
  - `item_id`: generated
  - `name`: from AI summary
  - `category`: AWP class name
  - `floor`: from AI summary
  - `area_sqft`: from AI summary
  - `awp_class_id`: from source table lookup
- Shows success toast with count

**Props change**: `AnalysisSectionProps` gains `projectId: string` passed from `AnalysisRequestDetail` (from `request.project_id`).

## 4. PDF Preview in File Modal

**File: `src/pages/AnalysisRequestDetail.tsx`**

- Import `pdfjs-dist` and set worker path
- When `selectedFile` has PDF mime type:
  - Download blob from Supabase storage
  - Load with `pdfjsLib.getDocument()`
  - Render pages to canvas elements
- Widen dialog to `sm:max-w-3xl` for PDFs
- Determine correct bucket based on `source_type` (manual_upload -> uploaded-drawings, else -> drive-analysis-files)

---

## Technical Details

### Files to create
1. `supabase/functions/summarize-analysis/index.ts` -- new edge function

### Files to modify
1. `src/components/analysis/AnalysisSection.tsx`:
   - Fix `parseResultText` to scan for header row
   - Add `projectId` prop
   - Add auto-summarize logic after analysis completes
   - Add summarized results display with "Add to Project" button
   - Add state for `summarizedInstances`, `summarizing`, `addingToProject`
   - Fetch AWP class metadata (id, id_prefix) from source tables for ID generation

2. `src/pages/AnalysisRequestDetail.tsx`:
   - Pass `projectId={request.project_id}` to `AnalysisSection`
   - Add PDF rendering with pdfjs-dist
   - Dynamic bucket selection based on source_type
   - Widen dialog for PDF files

### Config update
- Add `summarize-analysis` function to `supabase/config.toml` with `verify_jwt = false`

### No database migrations required
The `project_analysis_items` table already has all needed columns.

