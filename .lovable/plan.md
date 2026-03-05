

# Plan: Tooltip Fix, Controls Cost Bug, Cover Page, and Chart in Executive Summary

## 1. Tooltip: Show Series Name on Hover

**Problem**: The `RechartsTooltip` formatter at line 323 returns `undefined` as the series name, so hovering only shows the formatted value without identifying which series it belongs to.

**Fix in `src/components/wizard/RiskTimelineChart3D.tsx`**:
- Update the `formatter` callback to return `[formattedValue, name]` instead of `[formattedValue, undefined]`. The `name` parameter is the third argument to the Recharts formatter function. This applies to all chart types (line, bar, area) since they all share `renderContent()`.

```typescript
formatter={(value: number, name: string) => [
  dataType === 'cost' 
    ? (value >= 1000 ? `$${(value / 1000).toFixed(1)}k` : `$${value}`)
    : Number(value).toFixed(1),
  name  // was 'undefined'
]}
```

---

## 2. Controls Cost Shifts with Date Range

**Problem**: In `useRiskTimelineData.ts`, when a control's actual start month falls outside the filtered date range, the code sets `effectiveStartIdx = 0` (line 627-628). This means the one-time cost gets placed at whatever month the range starts at, instead of being excluded or placed at the correct month.

**Root cause** (lines 624-628):
```typescript
const startIdx = months.indexOf(startMonth);
// If not found (-1), defaults to 0 → first visible month
const effectiveStartIdx = startIdx === -1 ? 0 : startIdx;
```

**Fix in `src/hooks/useRiskTimelineData.ts`**:
- When `startIdx === -1` (the control's actual start is before the visible range), skip the one-time cost entirely for that control (it already happened before the window). Monthly costs should still apply starting from index 0 (since the control is active during the visible range), but one-time costs should not shift.
- Similarly in the cost matrix calculation (line 358), the same pattern exists and needs the same fix.

Specifically:
- Track whether the start month was clipped. If `startIdx === -1`, set a flag `startClipped = true`.
- When `startClipped`, do NOT add one-time costs (they already occurred before the window).
- Monthly costs still apply from index 0 through `effectiveEndIdx`.

---

## 3. PDF Cover Page

**New file**: Copy `user-uploads://img_coverpage.jpg` to `src/assets/img_coverpage.jpg`

**Modify `src/components/reports/WaterRiskReport.tsx`**:
- Import the cover page background image and the RiskBlue logo.
- Add a full-page cover div as the first element before the existing header. The cover page will be:
  - A4-sized div (210mm x 297mm) with the background image.
  - A `#1480F9` overlay at 35% opacity on top of the image.
  - RiskBlue logo centered near the top.
  - "Water Mitigation Guideline" title below the logo.
  - Project name (large, centered) and city/state below it.
  - Bottom-left: "Created by" / "Prepared by" (or "Prepared and Created by" if same person) using the same logic already in the header.
  - "Status: Issued for Review"
  - Current date.
  - "Confidential. For project stakeholders only."
- The cover page div gets `page-break-after: always` so the existing content starts on page 2.

---

## 4. Risk Timeline Chart in Executive Summary (PDF)

**Approach**: Since Recharts renders to SVG/canvas in the browser and `html2canvas` captures it, we need to render the chart inside the report HTML so it gets captured during PDF generation.

**Modify `src/components/reports/WaterRiskReport.tsx`**:
- Add new props: `riskTimelineChartData` (pre-computed `RiskTimelineData`) and `dollarPerRiskPoint` (number).
- In the Executive Summary section (after the AI summary text and before the Identified Risks grid), render a static Risk Timeline chart using Recharts (`LineChart` with `totalRisk` and `totalDerisk` series, step-after type, matching the "Total Risk Points" preset).
- The chart will be ~500px tall, full width, with a "Today" reference line.
- Import necessary Recharts components directly into `WaterRiskReport.tsx`.

**Modify the parent component** that renders `WaterRiskReport` to pass the pre-computed chart data and dollar-per-risk-point value as props.

---

## Files to Modify

| File | Change |
|---|---|
| `src/components/wizard/RiskTimelineChart3D.tsx` | Fix tooltip formatter to include series name |
| `src/hooks/useRiskTimelineData.ts` | Fix one-time cost placement when date range is clipped |
| `src/components/reports/WaterRiskReport.tsx` | Add cover page, add Risk Timeline chart in executive summary |
| `src/assets/img_coverpage.jpg` | New file (copy from upload) |
| Parent component rendering WaterRiskReport | Pass chart data props |

