

## Plan: Export Analysis DOCX from Analysis Queue Detail Page

### What we're building
An "Export Analysis" button at the bottom of the `AnalysisRequestDetail` page that generates and downloads a `.docx` file. Each detection instance from the analysis summary gets its own page with a structured info table and the drawing image showing the red circle highlight.

### Technical approach

**1. Add Export button to `src/pages/AnalysisRequestDetail.tsx`**
- Add a `Download` icon button at the bottom of the page (after the `AnalysisSection`)
- The button will be disabled when there's no summary data
- Wire it to call an export function

**2. Create `src/lib/analysisDocxExporter.ts`** — the main export logic
- Install `docx` npm package for DOCX generation
- Fetch `summary_data` from the `analysis_requests` table (already available via existing query)
- For each instance across all AWP classes:
  - Determine category (Asset/Water System/Process) from `awpOrderData` lookup
  - Find the source file and result text (matching instance ID in `analysis_results`)
  - Find default controls from source tables (`critical_assets`/`water_systems`/`processes`)
  - Render the PDF page to a canvas, draw the red circle, and capture as a PNG image
  - Build a DOCX page with:
    - Table: Detection (N of X), Display ID, Display Name, Floor, Type (category), Class (AWP class name), Area/Diameter, Controls, File
    - Drawing image below the table (scaled to fit remaining page space)
  - Insert page break before next instance

**3. Drawing image generation**
- Reuse the existing PDF rendering logic (download from `drive-analysis-files` bucket, render with pdfjs at scale 2, find bbox via text layer search or AI bbox, draw red circle overlay)
- Convert canvas to PNG blob for embedding in DOCX

**4. Data flow**
```text
summary_data (from analysis_requests)
  → for each AWP class → for each instance:
      → query analysis_results to find source file + result_text
      → query analysis_request_files for storage_path + name
      → query source tables for default_control_ids → mitigation_controls for names
      → download PDF → render page → find bbox → draw circle → capture PNG
      → build DOCX page with table + image
```

### Key details
- Uses `docx` (npm) library with `Packer.toBlob()` for client-side generation
- Each page: US Letter size, 1" margins
- Table uses compact formatting to leave room for the drawing image
- Image scaled to fit within remaining page height after table
- Page breaks between instances
- "Detection | 1 of X" uses total count across all classes
- For pipes, header says "Diameter" instead of "Area (sqft)" and shows `pipe_diameter_mm` converted to inches
- Controls come from the AWP class's `default_control_ids` in the source table

### Files to create/modify
- `src/lib/analysisDocxExporter.ts` — new file with export logic
- `src/pages/AnalysisRequestDetail.tsx` — add Export button
- `package.json` — add `docx` dependency

