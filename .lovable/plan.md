# Plan: PDF Report Fixes and UI Changes (16 Items)

## 1. Remove RiskRed Dropdown (`src/components/AppHeader.tsx`, `src/components/LogoDropdown.tsx`)

Replace `<LogoDropdown />` in `AppHeader.tsx` with a simple clickable logo (just the RiskBlue logo image that navigates to `/projects`). The `LogoDropdown` component can be deleted or simplified to remove all hover dropdown, RiskRed, dialog, and ChevronDown logic.

## 2. Fix Report Filename (`src/lib/reportGenerator.ts`)

Change `generateReportFilename` to produce:  
`RiskBlue WaterMitigationGuideline {projectName} YYYY-MM-DD_HH-MM-SS`

Current: `RiskBlue ${reportType} ${cleanName} ${exportDate} ${exportTime}`  
Update: hardcode `"WaterMitigationGuideline"` as the report type prefix, and update all callers (`WaterMitigationGuidelinesStep.tsx` lines 99, 210; `ProjectWizard.tsx` lines 1729, 1826, 1855) to pass `"WaterMitigationGuideline"` or simply rely on the default.

## 3. Cover Page Left/Bottom Padding (`src/components/reports/WaterRiskReport.tsx`, line 662)

The content layer has `padding: '60px 50px'`. Change the left and bottom padding to `padding: '60px 50px 100px 100px'` (top right bottom left).

## 4. Remove "— Total Risk Points" from Chart Title (line 742)

Change `Risk Timeline — Total Risk Points` to just `Risk Timeline`.

## 5. Today Line: Solid Black, Derisk Line: Dashed (lines 759-768)

- Remove `strokeDasharray="4 4"` from the Today `ReferenceLine` to make it solid.
- Add `strokeDasharray="6 4"` to the "Total Derisk" `Line` component to make it dashed.

## 6. Reduce Wasted Space in Chart (line 752)

Reduce chart margins: change `margin={{ top: 5, right: 20, left: 10, bottom: 5 }}` to `margin={{ top: 10, right: 5, left: 5, bottom: 5 }}`.

## 7. Y-Axis Label (line 756)

Add `label` prop to `YAxis`: `<YAxis tick={{ fontSize: 8 }} label={{ value: 'Risk Points', angle: -90, position: 'insideLeft', fontSize: 9 }} />`

## 8. Font Size / Font Face

Current base is `text-[11px]` with many elements at `text-[10px]` and `text-[9px]`. The report uses the default browser/system sans-serif font (inherited from Tailwind). Increase the base font to `text-[12px]`, bump `text-[10px]` to `text-[11px]`, and `text-[9px]` to `text-[10px]`. Set `fontFamily: 'Inter, system-ui, sans-serif'` on the report container for consistency.

## 9. Vertical Centering for Identified Risks / Mitigation Boxes (lines 779-801)

The boxes already have `flex flex-col items-center justify-center` but the padding is `p-2` which may be too tight. Add explicit `min-h-[60px]` to ensure vertical centering is visible. For "No drawing available" placeholder (line 599), it already has `items-center justify-center` but verify `h-16` is sufficient — add `text-center` if missing.

## 10. Icon Placement for Type Config Icons (lines 833-894)

The icons use `flex items-center gap-1.5` which should vertically center. The issue is likely the `items-baseline` being inherited or the icon images having inconsistent whitespace. Change to explicitly use `items-center` and add `flex-shrink-0` to the img elements. Set `verticalAlign: 'middle'` on the img style.

## 11. Footer Logo Aspect Ratio (`src/lib/pdfExporter.ts`, line 161)

Already changed to `18x8.2` in previous edit. Need to verify the logo is being exported as PNG with transparency. The current `getImageBase64` uses `toDataURL('image/jpeg', 0.92)` which destroys transparency and may distort. Change to `'image/png'` for the logo.

## 12. Bullet Placement (lines 505-508, 613-616)

The `list-disc list-inside` puts bullets inside the text flow which can look off. Replace with custom bullet styling using `pl-4` with `list-disc list-outside` or use `before:content-['•'] before:mr-1` pseudo-elements with `flex`.

## 13. Location Badge Vertical Centering (lines 469-480, 555-566)

Change `items-start` to `items-center` on the flex container: `<div className="flex justify-between items-center mb-1">`.

## 14. Vertical Bar Alignment (lines 488, 574)

The `border-l-2` with `pl-2` and `items-baseline` may cause misalignment. Change `items-baseline` to `items-start` or remove it, and ensure the border covers the full height by removing `flex` from individual items and using a wrapping div.

## 15. Page Break Avoidance (`src/lib/pdfExporter.ts`)

html2canvas captures as one large image, so CSS `page-break` has no effect. To avoid content being cut mid-section, implement a smarter slicing approach in `pdfExporter.ts`: scan the source element for section boundaries (e.g., `.print-keep-together` elements), and when calculating page breaks, adjust `sourceY` to avoid splitting these sections. This is complex — a simpler approach is to add `style="break-inside: avoid"` on section containers and use a scanning pass that finds natural break points in the captured canvas by looking for rows of white pixels.

**Practical approach**: Before capture, measure each top-level section's offset and height. When slicing pages, if a section would be split, push it to the next page by adjusting the slice point upward. This requires refactoring the page loop in `generatePdfFromElement`.

## 16. Leading Zero Dates (`src/lib/reportGenerator.ts`)

`formatDate` uses `"MMM dd, yyyy"` → `"Mar 06, 2026"`. Change to `"MMM d, yyyy"` → `"Mar 6, 2026"`. Also fix `formatDateShort` from `"M/dd/yy"` to `"M/d/yy"`. Also in `WaterRiskReport.tsx` line 748, `format(new Date(month + '-01'), 'MMM yy')` is fine (no day). Check line 408: `format(dates.startDate, "MMM d, yyyy")` — already correct. The cover page line 691 uses `format(new Date(), 'MMMM d, yyyy')` — already correct.

---

## Files to Modify


| File                                                      | Changes                                                                                                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/components/AppHeader.tsx`                            | Replace `<LogoDropdown />` with simple logo link                                                                                                 |
| `src/components/LogoDropdown.tsx`                         | Simplify to just a clickable logo (no dropdown)                                                                                                  |
| `src/lib/reportGenerator.ts`                              | Fix filename format, fix `formatDate` leading zeros (`dd` → `d`)                                                                                 |
| `src/components/reports/WaterRiskReport.tsx`              | Items 3-10, 12-14: cover padding, chart title, chart line styles, font sizes, vertical centering, icon alignment, bullets, badges, vertical bars |
| `src/lib/pdfExporter.ts`                                  | Item 11: logo PNG format; Item 15: smart page breaking                                                                                           |
| `src/components/wizard/WaterMitigationGuidelinesStep.tsx` | Update `generateReportFilename` call to use correct report type                                                                                  |
| `src/pages/ProjectWizard.tsx`                             | Update `generateReportFilename` call to use correct report type                                                                                  |
