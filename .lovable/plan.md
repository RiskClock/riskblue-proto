

# Fix Pipe Size & Drawing Preview for Analysis-Added Instances

## Problem 1: Missing Pipe Diameter
The `summarize-analysis` edge function's tool schema doesn't include a `pipe_diameter` field. The `SummarizedInstance` interface also lacks it. So when "Add to Project" inserts rows into `project_analysis_items`, no `additional_parameters` with pipe diameter is stored.

## Problem 2: Hardcoded Drawing Preview
When DCW/ERM instances are added to the project via analysis, their `item_id` values (e.g., `DCW001`) match entries in the static `drawingMapper.ts`. The `LocationDetailsModal` prioritizes `getDrawingImage(location.id)` which returns these hardcoded template PNGs instead of showing the actual analyzed PDF drawing with the red bounding box overlay.

The fix: store the source drawing file reference and bounding box coordinates when adding to project, then use that in LocationDetailsModal to render the actual PDF with overlay — falling back to static drawings only when no source file is available.

## Changes

### 1. Add `pipe_diameter_mm` to summarize-analysis tool schema
**File: `supabase/functions/summarize-analysis/index.ts`**
- Add `pipe_diameter_mm` (number) to the tool's properties schema, described as "Pipe diameter in millimeters if this is a water system instance, or 0 if not applicable"
- This lets the AI extract pipe sizes from the analysis results

### 2. Expand `SummarizedInstance` interface
**File: `src/components/analysis/AnalysisSection.tsx`**
- Add `pipe_diameter_mm?: number` and `source_file_id?: string` and `bounding_box?: string` to the interface
- These will carry through from summarization to project insertion

### 3. Store pipe diameter and source file when adding to project
**File: `src/components/analysis/AnalysisSection.tsx` → `handleAddToProject`**
- Map `pipe_diameter_mm` to `additional_parameters: { pipeDiameterMM, pipeDiameterInches }` in the insert row
- Store the analysis request's source file info in `drawing_url` or `file_name` so the detail modal can locate the actual PDF

### 4. Update LocationDetailsModal to prefer actual analyzed drawings
**File: `src/components/wizard/LocationDetailsModal.tsx`**
- When an item has a `file_name` pointing to an analysis source file (stored in `drive-analysis-files` bucket), download and render the PDF with bounding box overlay instead of falling back to the static `drawingMapper` image
- Use the item's `coordinates` field (if stored) to show the red circle overlay
- Only fall back to `getDrawingImage()` when no source PDF is available

### 5. Pass source file + bounding box during "Add to Project"
**File: `src/components/analysis/AnalysisSection.tsx` → `handleAddToProject`**
- For each summarized instance, find the matching analysis result row to get `file_id` and bounding box from the result text
- Store `file_name` (the storage path from `analysis_request_files`) and parsed bounding box coordinates in the `project_analysis_items` row

## Files to update

| File | Change |
|---|---|
| `supabase/functions/summarize-analysis/index.ts` | Add `pipe_diameter_mm` to tool schema |
| `src/components/analysis/AnalysisSection.tsx` | Expand `SummarizedInstance`, update `handleAddToProject` to store pipe diameter + source file info |
| `src/components/wizard/LocationDetailsModal.tsx` | Prefer analysis source PDF with overlay over static `drawingMapper` images |

