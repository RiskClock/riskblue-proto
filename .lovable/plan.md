

# Fix Cover Page, Chart, Logo, and Layout in PDF Report

## Issues and Fixes

### 1. Cover page white border
The PDF exporter applies 15mm margins on every page, including the cover page. The cover page renders at 210mm x 297mm in HTML, but `html2canvas` captures it within the report container which then gets margins applied.

**Fix**: In `src/lib/pdfExporter.ts`, detect the first page and render it edge-to-edge (0 margins), then apply normal margins from page 2 onward. Add a new option `fullBleedFirstPage: true` to the export options, and when set, the first page image slice is placed at (0, 0) spanning the full page dimensions.

Update the callers in `WaterMitigationGuidelinesStep.tsx` and `ProjectWizard.tsx` to pass `fullBleedFirstPage: true`.

### 2. Chart not rendering (placeholder only)
The chart data is being passed correctly from the hook. The issue is that `ResponsiveContainer` requires its parent to have an explicit width in the DOM. When the report is rendered off-screen (`left: -9999px`), the container may have 0 width, causing the chart to not render.

**Fix**: In `WaterRiskReport.tsx`, replace `ResponsiveContainer` with a fixed-size `<LineChart width={680} height={260}>` so it renders regardless of container layout. This is more reliable for off-screen PDF rendering.

### 3. Wrong logo
The report and cover page import `riskblue-logo.jpg` (has background), but the app header uses `logo-riskblue.png` (transparent).

**Fix**: In `WaterRiskReport.tsx`, change the import from `riskblue-logo.jpg` to `logo-riskblue.png`. Also update in `WaterMitigationGuidelinesStep.tsx` for the footer logo. On the cover page, since it's on a blue overlay, the transparent PNG will look correct. For the footer logo in the PDF exporter, also pass the PNG version.

### 4. Cover page layout issues
Current layout: logo at top with 80px margin, title centered vertically, project name smaller than title, bottom text too small, date format uses `formatDate` which outputs "Mar 05, 2026".

**Fix in `WaterRiskReport.tsx` cover page section (lines 648-697)**:
- Move logo directly above the title (remove the `flex: 1` centered layout; instead position everything as a single centered block)
- Make project name font larger (40px) than "Water Mitigation Guideline" (28px)
- Make city/state same size as title (28px)
- Increase bottom text size from 12px to 16px
- Format date with `format(new Date(), "MMMM d, yyyy")` for "March 5, 2026" (no leading zero, full month name)

## Files to Change

| File | Change |
|---|---|
| `src/lib/pdfExporter.ts` | Add `fullBleedFirstPage` option; render page 0 without margins when enabled |
| `src/components/reports/WaterRiskReport.tsx` | Switch logo to `logo-riskblue.png`; fix chart to use fixed dimensions instead of `ResponsiveContainer`; rework cover page layout and text sizes; fix date format |
| `src/components/wizard/WaterMitigationGuidelinesStep.tsx` | Switch logo import to `logo-riskblue.png`; pass `fullBleedFirstPage: true` to PDF options |
| `src/pages/ProjectWizard.tsx` | Pass `fullBleedFirstPage: true` to PDF export calls |

