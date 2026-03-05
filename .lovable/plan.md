

# Remove `window.print()` and Replace with Programmatic PDF Export

## Problem
In `src/pages/ProjectWizard.tsx` (lines 1705-1728), the "Download as PDF" button on the main project wizard still uses `window.print()` (Chrome print dialog). The Procore export path (lines 1791-1818) already uses the programmatic `generatePdfFromElement` approach correctly.

## Fix

**File: `src/pages/ProjectWizard.tsx` (lines 1705-1728)**

Replace the `window.print()` block with the same programmatic approach used by the Procore export path:
1. Render `WaterRiskReport` off-screen in a container positioned at `left: -9999px` with `width: 210mm`
2. Wait for render + images
3. Call `generatePdfFromElement` with `returnBlob: false` (triggers `pdf.save()` download)
4. Pass `fullBleedFirstPage: true`, `coverElement` from `#cover-page` query, and the logo
5. Clean up the container afterward
6. Remove `document.title` manipulation (no longer needed without Chrome print)

This mirrors what `WaterMitigationGuidelinesStep.tsx` already does for its export. No other files need changes.

