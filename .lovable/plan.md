

## Plan: Fix Derisk Calculation + Add Dollar Per Risk Point Slider + UI Improvements

### Issue Summary

| # | Issue | Root Cause |
|---|-------|------------|
| 1 | Derisk points ~7345 vs Risk points ~475 | The derisk calculation sums control points for EVERY selected control instance (e.g., "Spill Kit" selected on 50 instances = 50 x 5 points = 250). Then it distributes this inflated total across ALL classes for EVERY month. This causes massive over-counting. |
| 2 | Need slider for dollar per risk point ($1k-$10k) | New feature |
| 3 | Show dollar per risk point + cost estimate in chart | New feature - need to multiply risk points by dollar value |
| 4 | Monthly vs Cumulative toggle always visible | Currently hidden when dataType is "risk" |

---

### Root Cause Analysis: Derisk Calculation Bug

**Current flawed logic (lines 417-422 of useRiskTimelineData.ts):**
```typescript
const totalDeriskPoints = selectedControlIds.reduce((sum, controlId) => {
  const controlName = controlId.includes('::') ? controlId.split('::')[1] : controlId;
  const normalizedControlName = controlName.toLowerCase().trim();
  const points = controlPointsLookup.get(normalizedControlName) || 0;
  return sum + points;
}, 0);
```

Problem: This sums control points for EVERY control-instance pair selected. If "Spill Kit" (5 points) is selected on 30 instances, it adds 150 points.

**Correct logic**: Derisk should equal risk when all controls are selected.

The proper approach:
1. For each class, calculate how many instances are selected
2. For each selected instance, calculate what fraction of its risk is mitigated based on selected controls
3. Sum this per month within the class's active date range

The derisk for an instance should equal its risk points when ALL of its controls are selected. Since risk = P x I per instance per month, derisk = P x I when all controls selected.

**Fix approach:**
- For each class: derisk = (selected_instances / total_instances) x class_risk_points x control_coverage_ratio
- Where control_coverage_ratio = (selected controls for this class) / (total controls for this class)

Or more simply: each instance's risk is P x I. When all controls on that instance are selected, derisk = P x I for that instance. So:
- deriskPerMonth[class] = sum of (P x I) for each selected instance in class, multiplied by fraction of controls selected

---

### Detailed Implementation

#### Fix 1: Correct Derisk Calculation

**File:** `src/hooks/useRiskTimelineData.ts`

Change the derisk logic to calculate per-class:

```typescript
// Build derisk matrix (based on selected instances and controls)
if (selectedInstanceIds.length > 0 && selectedControlIds.length > 0) {
  deriskMatrix = sortedClasses.map((classData, classIdx) => {
    const row: number[] = new Array(months.length).fill(0);
    
    if (!classData.startDate || !classData.endDate) return row;
    if (classData.selectedInstanceCount === 0) return row;
    
    const startMonth = format(startOfMonth(classData.startDate), "yyyy-MM");
    const endMonth = format(startOfMonth(classData.endDate), "yyyy-MM");
    
    const startIdx = months.indexOf(startMonth);
    const endIdx = months.indexOf(endMonth);
    
    const effectiveStartIdx = startIdx === -1 ? 0 : startIdx;
    const effectiveEndIdx = endIdx === -1 ? months.length - 1 : endIdx;
    
    if (effectiveStartIdx > effectiveEndIdx) return row;
    
    // Find instances that belong to this class
    const classInstanceIds = classData.instanceIds;
    
    // For each selected instance in this class, calculate derisk based on selected controls
    let classSelectedDerisk = 0;
    
    classInstanceIds.forEach(instanceId => {
      if (!selectedInstanceIds.includes(instanceId)) return;
      
      // Find the instance to get its controls
      const instance = analysisItems.find(item => item.id === instanceId);
      if (!instance) return;
      
      const instanceControls = instance.controls || [];
      if (instanceControls.length === 0) return;
      
      // Count how many of this instance's controls are selected
      const selectedControlCount = instanceControls.filter(controlName => {
        const controlId = `${instanceId}::${controlName}`;
        return selectedControlIds.includes(controlId);
      }).length;
      
      // Control coverage ratio for this instance
      const controlRatio = selectedControlCount / instanceControls.length;
      
      // Instance derisk = P x I x controlRatio
      classSelectedDerisk += classData.riskPoints * controlRatio;
    });
    
    // Apply to each month in the class's range
    for (let i = effectiveStartIdx; i <= effectiveEndIdx; i++) {
      row[i] = Math.round(classSelectedDerisk * 100) / 100;
    }
    
    return row;
  });
}
```

This ensures:
- When all instances are selected with all their controls: derisk = risk
- Partial selections scale proportionally

---

#### Fix 2: Add Dollar Per Risk Point Slider

**File:** `src/components/wizard/RiskTimelineChart3D.tsx`

Add to ChartSettings interface:
```typescript
interface ChartSettings {
  // ... existing
  dollarPerRiskPoint: number;  // New: $1000 to $10000
}
```

Add state initialization:
```typescript
const [settings, setSettings] = useState<ChartSettings>(() => ({
  // ... existing
  dollarPerRiskPoint: 5000,  // Default $5000
}));
```

Add slider to ControlPanel:
```typescript
import { Slider } from "@/components/ui/slider";

// Inside ControlPanel, after Date Range:
<Separator orientation="vertical" className="h-6" />

<div className="flex items-center gap-2">
  <Label className="text-xs text-muted-foreground whitespace-nowrap">$/Risk Point:</Label>
  <div className="flex items-center gap-2 w-48">
    <Slider
      value={[settings.dollarPerRiskPoint]}
      onValueChange={(v) => onSettingsChange({ ...settings, dollarPerRiskPoint: v[0] })}
      min={1000}
      max={10000}
      step={500}
      className="flex-1"
    />
    <span className="text-xs font-medium w-14 text-right">
      ${(settings.dollarPerRiskPoint / 1000).toFixed(1)}k
    </span>
  </div>
</div>
```

---

#### Fix 3: Display Dollar Amount and Cost Estimate in Chart

**File:** `src/components/wizard/RiskTimelineChart3D.tsx`

When dataType is "risk", we can also show the dollar equivalent based on the slider.

Add a display box above the chart:
```typescript
// Calculate cost estimate
const totalRiskThisMonth = data.totalPerMonth[data.todayMonthIndex ?? 0] || 0;
const totalDeriskThisMonth = data.totalDeriskPerMonth?.[data.todayMonthIndex ?? 0] || 0;
const netRisk = Math.max(0, totalRiskThisMonth - totalDeriskThisMonth);
const costEstimate = netRisk * settings.dollarPerRiskPoint;

// In render, add info box:
<div className="flex items-center gap-4 text-sm mb-2">
  <div className="flex items-center gap-2">
    <span className="text-muted-foreground">$/Risk Point:</span>
    <span className="font-semibold">${settings.dollarPerRiskPoint.toLocaleString()}</span>
  </div>
  {settings.dataType === 'risk' && (
    <>
      <Separator orientation="vertical" className="h-4" />
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">Net Risk:</span>
        <span className="font-semibold">{netRisk.toFixed(0)} pts</span>
      </div>
      <Separator orientation="vertical" className="h-4" />
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">Exposure Estimate:</span>
        <span className="font-semibold text-destructive">${costEstimate.toLocaleString()}</span>
      </div>
    </>
  )}
</div>
```

---

#### Fix 4: Monthly vs Cumulative Toggle Always Visible

**File:** `src/components/wizard/RiskTimelineChart3D.tsx`

Currently at line 1109, the cost mode toggle is wrapped in:
```typescript
{settings.dataType === 'cost' && (
```

Change to always show it (for both risk and cost modes):
```typescript
{/* Points/Cost Mode Toggle - always visible */}
<Separator orientation="vertical" className="h-6" />
<div className="flex items-center gap-1.5">
  <Label className="text-xs text-muted-foreground">View:</Label>
  <ToggleGroup 
    type="single" 
    value={settings.costMode} 
    onValueChange={(v) => v && onSettingsChange({ ...settings, costMode: v as 'monthly' | 'cumulative' })}
    size="sm"
  >
    <ToggleGroupItem value="monthly" className="text-xs px-2">Monthly</ToggleGroupItem>
    <ToggleGroupItem value="cumulative" className="text-xs px-2">Cumulative</ToggleGroupItem>
  </ToggleGroup>
</div>
```

**File:** `src/hooks/useRiskTimelineData.ts`

Update the risk matrix calculation to support cumulative mode:
```typescript
// After building the risk matrix, apply cumulative if needed
if (dataType === 'risk' && costMode === 'cumulative') {
  matrix = matrix.map(row => {
    let runningTotal = 0;
    return row.map(v => {
      runningTotal += v;
      return runningTotal;
    });
  });
  if (deriskMatrix) {
    deriskMatrix = deriskMatrix.map(row => {
      let runningTotal = 0;
      return row.map(v => {
        runningTotal += v;
        return runningTotal;
      });
    });
  }
}
```

Also update the Y-axis label logic:
```typescript
// In RiskTimelineChart3D.tsx
const yAxisLabel = useMemo(() => {
  if (settings.dataType === 'cost') {
    return settings.costMode === 'cumulative' ? 'Cumulative Cost ($)' : 'Monthly Cost ($)';
  }
  return settings.costMode === 'cumulative' ? 'Cumulative Risk Points' : 'Risk Points';
}, [settings.dataType, settings.costMode]);
```

---

### Files to Modify

| File | Changes |
|------|---------|
| `src/hooks/useRiskTimelineData.ts` | Fix derisk calculation, add cumulative mode for risk points |
| `src/components/wizard/RiskTimelineChart3D.tsx` | Add slider, cost estimate display, always-visible view toggle |

---

### Implementation Order

1. Fix derisk calculation in `useRiskTimelineData.ts`
2. Add `dollarPerRiskPoint` to settings and slider UI
3. Add cost estimate display
4. Make Monthly/Cumulative toggle always visible
5. Support cumulative mode for risk points

---

### Expected Behavior After Fix

When testing with all controls selected:
- **Before**: Derisk = 7345.8, Risk = 475 (wrong)
- **After**: Derisk = 475, Risk = 475 (correct - they should match)

New UI elements:
- Slider bar: "$1k - $10k per risk point" with current value displayed
- Info bar showing: "$/Risk Point: $5,000 | Net Risk: 0 pts | Exposure Estimate: $0"
- Monthly/Cumulative toggle visible for both Risk and Cost modes

