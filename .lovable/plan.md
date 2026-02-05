
## Plan: Fix Derisk Calculation Mismatch + UI Improvements

### Issues Summary

| # | Issue | Root Cause |
|---|-------|------------|
| 1 | Rounding issue (tooltip shows floating-point artifacts) | JavaScript floating-point precision in matrix calculations |
| 2 | Data toggle should be first control in panel | Current order: View (3D/2D) first, but user wants Data (Risk/Cost) first |
| 3 | Cost view should convert risk to cost using $/Risk Point slider | Current implementation uses mitigation control costs instead |
| 4 | **Derisk mismatch**: Timeline shows 184 pts vs ASP sections showing 341.6 pts | Timeline's derisk calculation is missing the instance count multiplier |

---

### Root Cause Analysis: Derisk Calculation Bug

**Current logic in `useRiskTimelineData.ts` (lines 437-461):**

```typescript
classData.instanceIds.forEach(instanceId => {
  if (!selectedInstanceIds.includes(instanceId)) return;
  
  const instanceControls = instance.controls || [];
  const selectedControlCount = instanceControls.filter(controlName => {
    const controlId = `${instanceId}::${controlName}`;
    return selectedControlIds.includes(controlId);
  }).length;
  
  const controlRatio = selectedControlCount / instanceControls.length;
  
  // BUG: Uses classData.riskPoints (P × I) but should match useRiskScoring logic
  classTotalDerisk += classData.riskPoints * controlRatio;
});
```

**Correct logic in `useRiskScoring.ts` (lines 239-253):**

```typescript
const weightedDerisk = totalControlWeight > 0 
  ? (weight / totalControlWeight) * instanceRiskPoints
  : 0;
// Each instance contributes its own derisk based on control weights
```

**The Problem:**
1. `useRiskScoring` uses **weighted control points** (proportional to control "points" value)
2. `useRiskTimelineData` uses **simple control count ratio** (all controls treated equally)

For example, if an instance has 3 controls with weights 10, 5, 2 (total 17):
- Selecting all 3: `useRiskScoring` = 100% derisk, `useRiskTimelineData` = 100% derisk (matches)
- Selecting only the 10-point control: `useRiskScoring` = 10/17 = 58.8% derisk, `useRiskTimelineData` = 1/3 = 33% derisk (mismatch!)

This explains why the timeline shows 184 pts mitigated while ASP shows 341.6 pts.

---

### Files to Modify

| File | Changes |
|------|---------|
| `src/hooks/useRiskTimelineData.ts` | Fix derisk calculation to use weighted control points; fix rounding |
| `src/components/wizard/RiskTimelineChart3D.tsx` | Reorder controls (Data first); fix cost view to use risk × $/point |

---

### Technical Implementation

#### Fix 1: Correct Derisk Calculation with Weighted Control Points

**File:** `src/hooks/useRiskTimelineData.ts`

Replace the simple control count ratio with weighted control points:

```typescript
// For each selected instance in this class, calculate derisk based on WEIGHTED control coverage
let classTotalDerisk = 0;

classData.instanceIds.forEach(instanceId => {
  if (!selectedInstanceIds.includes(instanceId)) return;
  
  const instance = analysisItems.find(item => item.id === instanceId);
  if (!instance) return;
  
  const instanceControls = instance.controls || [];
  if (instanceControls.length === 0) {
    // If no controls on instance, selecting it means full derisk
    classTotalDerisk += classData.riskPoints;
    return;
  }
  
  // Calculate total weight of ALL controls on this instance
  let totalControlWeight = 0;
  instanceControls.forEach(controlName => {
    const normalizedName = controlName.toLowerCase().trim();
    const points = controlPointsLookup.get(normalizedName) || 1;
    totalControlWeight += points;
  });
  
  // Calculate weight of SELECTED controls for this instance
  let selectedControlWeight = 0;
  instanceControls.forEach(controlName => {
    const controlId = `${instanceId}::${controlName}`;
    if (selectedControlIds.includes(controlId)) {
      const normalizedName = controlName.toLowerCase().trim();
      const points = controlPointsLookup.get(normalizedName) || 1;
      selectedControlWeight += points;
    }
  });
  
  // Weighted control ratio for this instance
  const controlRatio = totalControlWeight > 0 
    ? selectedControlWeight / totalControlWeight 
    : 0;
  
  // Instance derisk = P × I × weighted_control_ratio
  classTotalDerisk += classData.riskPoints * controlRatio;
});
```

This now matches the `useRiskScoring` logic exactly.

---

#### Fix 2: Rounding Precision

**File:** `src/hooks/useRiskTimelineData.ts`

Replace all `Math.round(x * 100) / 100` with `Number(value.toFixed(2))`:

```typescript
// Line 358:
row[i] = Number((oneTime + instanceMonthlyCost).toFixed(2));

// Line 466:
row[i] = Number(classTotalDerisk.toFixed(2));
```

**File:** `src/components/wizard/RiskTimelineChart3D.tsx`

Add tooltip formatter for Recharts to round displayed values:

```typescript
<RechartsTooltip 
  contentStyle={...}
  formatter={(value: number) => [Number(value).toFixed(1), undefined]}
/>
```

---

#### Fix 3: Reorder Control Panel - Data Type First

**File:** `src/components/wizard/RiskTimelineChart3D.tsx` - `ControlPanel` component

Move the "Data Type Toggle" (lines 1096-1108) to be the **first control** in the panel, before the View (3D/2D) toggle.

**New order:**
1. Data (Risk Points / Cost)
2. View (3D / 2D)
3. Mode (Total / By Type)
4. Style (Line / Bars / etc.)
5. View (Monthly / Cumulative)
6. $/Risk Point slider
7. Date Range
8. Fullscreen button

---

#### Fix 4: Cost View Uses Risk × $/Risk Point

**File:** `src/components/wizard/RiskTimelineChart3D.tsx`

Currently when `dataType === 'cost'`, it shows mitigation control costs. The user wants it to show:
- **Risk Cost** = Risk Points × $/Risk Point
- **Derisk Cost** = Derisk Points × $/Risk Point

This means the "Cost" view is really a dollar-value representation of the risk/derisk, not mitigation costs.

**Implementation approach:**

1. Update Chart2D to accept `dataType` and `dollarPerRiskPoint` as props
2. When `dataType === 'cost'`, multiply all risk and derisk values by `dollarPerRiskPoint`
3. Update Y-axis label to "Monthly Exposure Cost ($)" or "Cumulative Exposure Cost ($)"

```typescript
// In Chart2D chartData calculation:
const multiplier = dataType === 'cost' ? dollarPerRiskPoint : 1;

const chartData = useMemo(() => {
  return months.map((month, idx) => {
    const entry: Record<string, any> = {
      month: format(parseISO(month + "-01"), "MMM yyyy"),
      fullMonth: month,
    };

    if (mode === 'total') {
      entry.totalRisk = totalPerMonth[idx] * multiplier;
      if (showDerisk && totalDeriskPerMonth) {
        entry.totalDerisk = totalDeriskPerMonth[idx] * multiplier;
      }
    } else {
      aspTypes.forEach((type, typeIdx) => {
        if (visibleTypes.includes(type.name)) {
          entry[type.name] = matrix[typeIdx][idx] * multiplier;
          if (showDerisk && deriskMatrix && deriskMatrix[typeIdx]) {
            entry[`${type.name}_derisk`] = deriskMatrix[typeIdx][idx] * multiplier;
          }
        }
      });
    }

    return entry;
  });
}, [months, mode, totalPerMonth, totalDeriskPerMonth, ..., dataType, dollarPerRiskPoint]);
```

Similarly update ChartScene (3D) to apply the multiplier.

---

### Implementation Order

1. Fix derisk calculation in `useRiskTimelineData.ts` to use weighted control points
2. Fix rounding precision in both files
3. Reorder ControlPanel controls (Data type first)
4. Update Chart2D and ChartScene to apply dollar multiplier when dataType is 'cost'
5. Update Y-axis labels for cost view

---

### Expected Behavior After Fix

**Derisk calculation:**
- Timeline "Mitigated" value will match the sum of ASP section derisk values
- When all controls selected: derisk = risk (100% mitigation)

**UI improvements:**
- "Data: Risk Points | Cost" toggle appears first in control panel
- Cost view shows risk/derisk multiplied by $/Risk Point slider value
- Tooltips display properly rounded values (no floating-point artifacts)

**Example verification:**
- ASP shows: Risk = 405 pts, DeRisk = 341.6 pts
- Timeline should show: Current Risk ≈ 405 pts, Mitigated ≈ 342 pts, Net Risk ≈ 63 pts
