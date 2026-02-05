

## Plan: Fix Slider Scale, Cost Calculation, Info Bar Removal, and Dual Cost Series

### Issues to Address

| # | Issue | Root Cause |
|---|-------|------------|
| 1 | Slider scale $1k-$10k, needs $1-$100 | Hardcoded min=1000, max=10000 in Slider component |
| 2 | Cost view shows $0 | The data IS 400 pts in Risk mode, but Cost mode calculation appears broken - possibly due to not applying multiplier correctly in the exposure bar, or the totalPerMonth array being empty when dataType='cost' settings are used incorrectly |
| 3 | Remove ExposureInfoBar between controls and graph | ExposureInfoBar is rendered between ControlPanel and chart |
| 4 | Cost mode should show Risk Cost + Controls Cost | Current implementation only multiplies risk points by $/pt; needs a second series for actual control implementation costs |

---

### Technical Analysis

#### Issue 2 Deep Dive: Why Cost Shows $0

Looking at the code flow:

1. **Hook always returns risk data** (line 1245: `dataType: 'risk'`)
2. **Chart2D applies multiplier correctly** (line 863): `const multiplier = dataType === 'cost' ? dollarPerRiskPoint : 1`
3. **ExposureInfoBar reads from data.totalPerMonth** which contains risk points

The problem: In the ExposureInfoBar calculation (lines 1323-1345):
```typescript
const totalRiskThisMonth = data.totalPerMonth[currentMonthIndex] || 0;
```

If `data.totalPerMonth` contains values like 400 and the multiplier is 5000, then `displayRisk = 400 * 5000 = 2,000,000`. But screenshot shows $0.

Possible causes:
- `data.todayMonthIndex` is null or outside the valid range
- `data.totalPerMonth` is empty
- The multiplier logic has a bug

The screenshot shows the graph WITH data (400 pts line visible), but ExposureInfoBar shows "0 pts". This means `data.todayMonthIndex` is likely null or returning wrong index.

Checking: Today is Feb 2026, but construction_start_date might be later, causing todayMonthIndex to be null.

**Fix**: Fallback to index 0 or the last valid index when todayMonthIndex is null or 0.

---

### Implementation

#### Change 1: Update Slider Scale to $1-$100

**File:** `src/components/wizard/RiskTimelineChart3D.tsx`

```typescript
// Line 1144-1153: Change slider min/max and display
<Slider
  value={[settings.dollarPerRiskPoint]}
  onValueChange={(v) => onSettingsChange({ ...settings, dollarPerRiskPoint: v[0] })}
  min={1}
  max={100}
  step={1}
  className="flex-1"
/>
<span className="text-xs font-medium w-12 text-right">
  ${settings.dollarPerRiskPoint}
</span>

// Line 1209: Update default value
dollarPerRiskPoint: 50,  // Default $50 per risk point
```

Update label format throughout (exposure bar, tooltip, etc.) to just show `$50` instead of `$50k`.

---

#### Change 2: Fix Cost Calculation - Use Best Available Month Index

**File:** `src/components/wizard/RiskTimelineChart3D.tsx`

Update exposureInfo calculation to handle null todayMonthIndex:

```typescript
const exposureInfo = useMemo(() => {
  // Use today's month if available, otherwise use the last month with data
  let currentMonthIndex = data.todayMonthIndex;
  if (currentMonthIndex === null || currentMonthIndex < 0) {
    // Find the last month with non-zero data
    currentMonthIndex = data.totalPerMonth.findIndex(v => v > 0);
    if (currentMonthIndex === -1) currentMonthIndex = 0;
  }
  
  const totalRiskThisMonth = data.totalPerMonth[currentMonthIndex] || 0;
  const totalDeriskThisMonth = data.totalDeriskPerMonth?.[currentMonthIndex] || 0;
  const netRisk = Math.max(0, totalRiskThisMonth - totalDeriskThisMonth);
  const exposureEstimate = netRisk * settings.dollarPerRiskPoint;
  
  const isCostMode = settings.dataType === 'cost';
  const multiplier = isCostMode ? settings.dollarPerRiskPoint : 1;
  
  return {
    totalRisk: totalRiskThisMonth,
    totalDerisk: totalDeriskThisMonth,
    netRisk,
    exposureEstimate,
    displayRisk: isCostMode ? totalRiskThisMonth * multiplier : totalRiskThisMonth,
    displayDerisk: isCostMode ? totalDeriskThisMonth * multiplier : totalDeriskThisMonth,
    displayNet: isCostMode ? netRisk * multiplier : netRisk,
    isCostMode
  };
}, [data.totalPerMonth, data.totalDeriskPerMonth, data.todayMonthIndex, settings.dollarPerRiskPoint, settings.dataType]);
```

---

#### Change 3: Remove ExposureInfoBar from Main UI

**File:** `src/components/wizard/RiskTimelineChart3D.tsx`

Remove the ExposureInfoBar between ControlPanel and chart (line 1484):

```typescript
// Lines 1473-1495: Remove <ExposureInfoBar /> calls (both main and modal)
return (
  <>
    <div ref={containerRef} className="space-y-4">
      <ControlPanel ... />
      
      {/* REMOVED: <ExposureInfoBar /> */}

      {renderChartContent('h-[400px]')}

      <Legend ... />
    </div>
    ...
  </>
);
```

Also remove from modal (line 1512).

---

#### Change 4: Cost Mode Shows Risk Cost + Controls Cost

**Approach**: When `dataType === 'cost'`, show two series:
1. **Risk Cost** (red) = risk points × $/risk point (potential exposure)
2. **Controls Cost** (blue/teal) = cumulative implementation cost of selected controls

This requires:
1. Calculating per-month controls cost in the timeline hook
2. Adding a new series to Chart2D
3. Updating legends and tooltips

**File:** `src/hooks/useRiskTimelineData.ts`

Add controls cost matrix to the returned data:

```typescript
interface RiskTimelineData {
  // ... existing
  controlsCostMatrix: number[][] | null;  // NEW: Per-class controls cost per month
  totalControlsCostPerMonth: number[] | null;  // NEW: Total controls cost per month
}
```

Calculate controls cost using the existing cost calculation logic (one-time in first month + monthly ongoing):

```typescript
// After building risk matrix, if we have cost data, calculate controls cost matrix
let controlsCostMatrix: number[][] | null = null;
let totalControlsCostPerMonth: number[] | null = null;

if (selectedControlIds.length > 0 && controlsData.length > 0) {
  // Build cost lookup
  const costLookup = new Map<string, { oneTime: number; monthly: number }>();
  controlsData.forEach(c => {
    costLookup.set(c.name.toLowerCase().trim(), {
      oneTime: c.oneTimeCost || 0,
      monthly: c.monthlyCost || 0
    });
  });
  
  controlsCostMatrix = sortedClasses.map((classData) => {
    const row: number[] = new Array(months.length).fill(0);
    if (!classData.startDate || !classData.endDate) return row;
    if (classData.selectedInstanceCount === 0) return row;
    
    const startMonth = format(startOfMonth(classData.startDate), "yyyy-MM");
    const startIdx = months.indexOf(startMonth);
    const endMonth = format(startOfMonth(classData.endDate), "yyyy-MM");
    const endIdx = months.indexOf(endMonth);
    
    const effectiveStartIdx = startIdx === -1 ? 0 : startIdx;
    const effectiveEndIdx = endIdx === -1 ? months.length - 1 : endIdx;
    
    // For each selected instance in this class
    classData.instanceIds.forEach(instanceId => {
      if (!selectedInstanceIds.includes(instanceId)) return;
      
      const instance = analysisItems.find(item => item.id === instanceId);
      if (!instance) return;
      
      (instance.controls || []).forEach(controlName => {
        const controlId = `${instanceId}::${controlName}`;
        if (!selectedControlIds.includes(controlId)) return;
        
        const costs = costLookup.get(controlName.toLowerCase().trim());
        if (!costs) return;
        
        // Add one-time cost to first month, monthly cost to all months
        for (let i = effectiveStartIdx; i <= effectiveEndIdx; i++) {
          if (i === effectiveStartIdx) {
            row[i] += costs.oneTime;
          }
          row[i] += costs.monthly;
        }
      });
    });
    
    return row;
  });
  
  // Calculate totals
  totalControlsCostPerMonth = months.map((_, monthIdx) => {
    return controlsCostMatrix!.reduce((sum, row) => sum + row[monthIdx], 0);
  });
  
  // Apply cumulative if needed
  if (costMode === 'cumulative' && totalControlsCostPerMonth) {
    let running = 0;
    totalControlsCostPerMonth = totalControlsCostPerMonth.map(v => {
      running += v;
      return running;
    });
  }
}
```

**File:** `src/components/wizard/RiskTimelineChart3D.tsx`

Update Chart2D to render controls cost series:

```typescript
// In chartData calculation, add controls cost
if (dataType === 'cost') {
  if (mode === 'total') {
    entry.riskCost = Number((totalPerMonth[idx] * dollarPerRiskPoint).toFixed(2));
    entry.controlsCost = totalControlsCostPerMonth ? totalControlsCostPerMonth[idx] : 0;
    if (showDerisk && totalDeriskPerMonth) {
      entry.mitigatedCost = Number((totalDeriskPerMonth[idx] * dollarPerRiskPoint).toFixed(2));
    }
  }
}

// Add to chart rendering (when dataType === 'cost'):
<RechartsLine type="stepAfter" dataKey="riskCost" stroke="#ef4444" name="Risk Cost" dot={false} strokeWidth={2} />
<RechartsLine type="stepAfter" dataKey="controlsCost" stroke="#0ea5e9" name="Controls Cost" dot={false} strokeWidth={2} />
```

---

### Files to Modify

| File | Changes |
|------|---------|
| `src/components/wizard/RiskTimelineChart3D.tsx` | Update slider scale, fix cost calculation, remove ExposureInfoBar, add controls cost series |
| `src/hooks/useRiskTimelineData.ts` | Add controls cost matrix calculation |
| `src/pages/ProjectWizard.tsx` | Pass control cost data to RiskTimelineChart3D (already has `controlCosts` from query) |

---

### Implementation Order

1. Update slider scale from $1k-$10k to $1-$100
2. Fix exposure calculation fallback when todayMonthIndex is null
3. Remove ExposureInfoBar from between controls and graph
4. Add controls cost data to controlsData prop (include oneTimeCost and monthlyCost)
5. Calculate controls cost matrix in useRiskTimelineData
6. Update Chart2D to show both Risk Cost and Controls Cost series in cost mode
7. Update legend and tooltips for cost mode

---

### Expected Behavior

After implementation:
- **Slider**: Shows $1 to $100 range with $50 default
- **Cost mode**: Displays two lines/bars:
  - Red: Risk Cost (risk points × $/pt) showing potential exposure
  - Teal/Blue: Controls Cost (implementation spend on selected controls)
- **No info bar**: Clean layout with controls directly above chart
- **Proper values**: Even when today's month is outside construction range, shows meaningful data from the first active month

