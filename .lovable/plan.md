
## Plan: Fix Derisk Calculation Mismatch + UI Improvements ✅ COMPLETED

### Issues Summary

| # | Issue | Status |
|---|-------|--------|
| 1 | Rounding issue (tooltip shows floating-point artifacts) | ✅ Fixed |
| 2 | Data toggle should be first control in panel | ✅ Fixed |
| 3 | Cost view should convert risk to cost using $/Risk Point slider | ✅ Fixed |
| 4 | **Derisk mismatch**: Timeline vs ASP sections | ✅ Fixed |

---

### Changes Made

#### 1. Derisk Calculation Fixed (`src/hooks/useRiskTimelineData.ts`)
- Changed from simple control count ratio to **weighted control points**
- Now matches `useRiskScoring.ts` logic exactly:
  - Calculates `totalControlWeight` from all controls on instance
  - Calculates `selectedControlWeight` from selected controls
  - Uses `selectedControlWeight / totalControlWeight` as the ratio

#### 2. Rounding Precision Fixed
- `useRiskTimelineData.ts`: Changed `Math.round(x * 100) / 100` to `Number(value.toFixed(2))`
- `RiskTimelineChart3D.tsx`: Added tooltip formatter to round displayed values

#### 3. Control Panel Reordered
- "Data: Risk Points | Cost" is now the **first control** in the panel
- Order: Data → View (3D/2D) → Mode → Style → View (Monthly/Cumulative) → $/Risk Point → Date Range → Fullscreen

#### 4. Cost View Updated
- When `dataType === 'cost'`, chart now shows:
  - **Risk Cost** = Risk Points × $/Risk Point
  - **Derisk Cost** = Derisk Points × $/Risk Point
- Chart2D receives `dataType` and `dollarPerRiskPoint` props
- Values multiplied by `dollarPerRiskPoint` for cost visualization
- Tooltip formats values as currency when in cost mode

---

### Expected Behavior

- Timeline "Mitigated" value matches ASP section derisk sums
- When all controls selected: derisk ≈ risk (100% mitigation)
- "Data" toggle appears first in control panel
- Cost view shows risk × $/Risk Point (not mitigation costs)
- Tooltips display properly rounded values
