

# Implement Cover Page Spec: Inset Panel + Full-Bleed Fix

## Changes

### 1. Cover Page HTML — Add Black Translucent Inset Panel (`src/components/reports/WaterRiskReport.tsx`, lines 648-694)

Replace the current cover page markup with the spec's layered structure:

- `#cover-page` outer div: `position: relative; width: 210mm; height: 297mm; margin: 0; padding: 0; overflow: hidden`
- Layer 1: Background image (absolute, fills 100%)
- Layer 2: Blue overlay (`rgba(20, 128, 249, 0.35)`, absolute, fills 100%)
- Layer 3: Black translucent inset panel — `position: absolute; inset: 24px; background: rgba(0,0,0,0.28); border: 1px solid rgba(255,255,255,0.10); box-shadow: 0 0 0 1px rgba(0,0,0,0.15) inset; z-index: 1`
- Layer 4: Content div — `position: relative; z-index: 2; height: 100%; padding: 60px 50px; display: flex; flex-direction: column` (same content as now: logo, title, project name, attribution, etc.)

### 2. PDF Exporter — Debug Option (`src/lib/pdfExporter.ts`)

Add `debugSaveCoverPng?: boolean` to `PdfExportOptions`. When true and on page 0, download the raw canvas slice as a PNG before placing it in the PDF. This is dev-only for diagnosing margin vs. capture issues.

### 3. Verify Full-Bleed Logic

The `fullBleedFirstPage` option already exists and is passed by callers. Just confirm the exporter places page 0 at `(0, 0)` spanning `pageWidth x pageHeight` — this is already implemented. No changes needed here.

## Files

| File | Change |
|---|---|
| `src/components/reports/WaterRiskReport.tsx` | Add inset panel overlay div, update z-index on content, add `id="cover-page"` |
| `src/lib/pdfExporter.ts` | Add `debugSaveCoverPng` option for dev diagnostics |

