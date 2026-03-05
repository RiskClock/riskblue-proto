

# Fix All Remaining Cover Page Issues

## Changes

### 1. Eliminate duplicate cover page (`src/components/reports/WaterRiskReport.tsx`)
Wrap everything after `#cover-page` (line 698 onward, the `<div className="p-4">` through end) inside `<div id="report-body">`. The exporter already queries `#report-body` but currently falls back to the full container because no such element exists, causing the cover to render twice.

### 2. Update inset panel styling (same file, line 658)
- Change `inset: '24px'` to `inset: '48px'`
- Remove `border` and `boxShadow` properties entirely

### 3. Replace cover logo with transparent version
- Save uploaded `RiskBlue_complete_blackbg.png` as `src/assets/logo-riskblue-white.png`
- Import it in `WaterRiskReport.tsx` and use it for the cover page logo (line 665)
- Increase logo height from `48px` to `64px`

### 4. Fix squished footer logos (`src/lib/pdfExporter.ts`, line 161)
Currently hardcoded as `18mm x 6mm` (3:1 ratio), distorting the logo. Change to `18mm x 8.2mm` (~2.2:1 ratio matching the actual logo proportions), and adjust Y position accordingly: `pageHeight - 14` instead of `pageHeight - 12`.

## Files

| File | Change |
|---|---|
| `src/assets/logo-riskblue-white.png` | New file (uploaded transparent logo) |
| `src/components/reports/WaterRiskReport.tsx` | Wrap body in `#report-body`; thicker inset (48px), no border/shadow; new logo, bigger (64px) |
| `src/lib/pdfExporter.ts` | Footer logo: `18x8.2` instead of `18x6` |

