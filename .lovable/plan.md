

## Plan: Fix 7 Issues + Add Cost View Toggle in Risk Timeline Chart

### Summary of Issues Found

| # | Issue | Root Cause | Priority |
|---|-------|------------|----------|
| 1 | 3D Y-axis scale doesn't change between Total/By Type | Camera position is fixed; no dynamic scaling or auto-fit | High |
| 2 | ASP visibility checkbox still doesn't work | Checkbox `onToggle` calls `handleToggleType` but the toggle may be affected by state sync issues | Medium |
| 3 | Processes don't appear in chart | `mapToProcessName` returns `null` for items that don't match the lookup - the `processes` table has items but `durationCalculator.ts::calculateSystemOrAssetDates` doesn't handle Process category | High |
| 4 | Derisk always 0 in Total view | `selectedControlIds` contains control names but lookup uses IDs, OR the control points lookup isn't matching due to format differences | High |
| 5 | Switch between Risk Points vs Cost Estimates | New feature requested | Medium |
| 6 | Y-axis doesn't show in 3D | No Y-axis visual component rendered in Three.js scene | Medium |
| 7 | Label Y-axis | Need to add text labels for Y-axis | Low |

---

### Detailed Root Cause Analysis

#### Issue 1: 3D Y-axis Scale Doesn't Change

In `ChartScene`, the `SCALE_Y = 0.12` constant is applied uniformly. When switching from "By Type" (values ~15-90 per class) to "Total" (values ~400+), the bars become extremely tall because the same scale is used.

**Solution**: Calculate `SCALE_Y` dynamically based on the maximum value in the current view mode.

---

#### Issue 2: ASP Checkbox Not Working

The checkbox calls `handleToggleType(name)` which updates `visibleTypes` state correctly. However, I found that the `useEffect` at lines 1008-1024 adds new types but never removes types. The issue may be that when clicking checkbox, the filtered data in `Chart2D` and `ChartScene` correctly excludes hidden types, but visually something may be resetting.

After review, the toggle logic itself is correct. The issue is likely that the `visibleAspTypes` filter in `Chart2D` works, but if the user is in 3D mode, the `visibleTypes` filter in `ChartScene` also needs to be applied.

Looking at `ChartScene`:
- Line 367-371: `visibleTypeData` correctly filters by `visibleTypes.has(type.name)`
- This should work

Need to verify the checkbox `onCheckedChange` handler is correctly wired. The Legend component at line 634 has:
```tsx
<Checkbox
  checked={visibleTypes.has(t.name)}
  onCheckedChange={() => onToggle(t.name)}
```

This looks correct. The issue may be a React re-render glitch where the Set comparison causes stale state.

**Solution**: Convert `visibleTypes` from `Set` to array for more predictable React state updates.

---

#### Issue 3: Processes Not Appearing

In `useRiskTimelineData.ts`, the `getClassName` function at line 141-146:
```typescript
if (item.category === 'Process') return mapToProcessName(item.name);
```

`mapToProcessName` (line 174-189 in analysisItemMapper.ts) handles:
- "Contractor Team"
- "Water Mitigation Vendor Process"
- "Mechanical Contractor Process"
- "Engineering Process"

But in `calculateSystemOrAssetDates` (durationCalculator.ts line 255-346), there's **no handling for Process category**. Processes fall through and return `{ startDate: null, endDate: null }`.

Since processes span the whole project (per user confirmation), we need to add Process handling.

**Solution**: Add Process handling in `calculateSystemOrAssetDates` to use construction_start_date to construction_end_date.

---

#### Issue 4: Derisk Always 0

In `useRiskTimelineData.ts`, the derisk calculation at lines 336-376:

1. Line 337-343: Calculates `totalDeriskPoints` by iterating over `selectedControlIds`
2. Line 340: `controlPointsLookup.get(normalizedControlId)` - the lookup is keyed by normalized control name

The issue is that `selectedControlIds` passed from `RiskTimelineChart3D` at line 993-996:
```typescript
selectedControlIds: [
  ...(projectData.selectedAssetControls || []),
  ...(projectData.selectedSystemControls || []),
  ...(projectData.selectedProcessControls || [])
]
```

These are control IDs in format `instanceId::controlName` (from `getControlId`), NOT control names!

**Root Cause**: The control ID format is `"{instanceId}::{controlName}"` but the lookup expects just the control name.

**Solution**: Parse the control name from the composite ID before lookup.

---

#### Issue 5: Risk Points vs Cost Estimates Toggle

Add a new toggle in the control panel to switch Y-axis between:
- **Risk Points**: Current behavior (P x I values per month)
- **Monthly Cost**: Monthly maintenance cost for selected controls
- **Cumulative Cost**: Running total of costs

For cost calculation, we'll use the `calculateTieredControlCost` logic from `costCalculator.ts`.

---

#### Issue 6 & 7: Y-Axis Not Visible & Labeling

Currently, the 3D scene has no Y-axis geometry. Need to add:
- A vertical line (Y-axis)
- Tick marks at intervals
- Labels showing values

---

### Files to Modify

| File | Changes |
|------|---------|
| `src/components/wizard/RiskTimelineChart3D.tsx` | Issues 1, 2, 5, 6, 7 |
| `src/hooks/useRiskTimelineData.ts` | Issues 3, 4, 5 |
| `src/lib/durationCalculator.ts` | Issue 3 |

---

### Technical Implementation

#### Issue 1: Dynamic Y-Axis Scaling

```typescript
// In ChartScene, calculate dynamic scale based on max value in current mode
const maxValue = useMemo(() => {
  if (mode === 'total') {
    return Math.max(...totalPerMonth, 1);
  }
  // By Type mode: find max across visible types
  let max = 1;
  visibleTypeData.forEach(({ originalIndex }) => {
    const rowMax = Math.max(...matrix[originalIndex]);
    if (rowMax > max) max = rowMax;
  });
  return max;
}, [mode, totalPerMonth, visibleTypeData, matrix]);

// Dynamic scale to keep chart in reasonable viewport (target max height ~6 units)
const dynamicScaleY = 6 / maxValue;
```

Also, use Three.js `OrbitControls` auto-fit or adjust camera target based on content bounds.

---

#### Issue 2: Convert visibleTypes to Array

Replace `Set<string>` with `string[]` for more predictable React state:

```typescript
// Before:
const [visibleTypes, setVisibleTypes] = useState<Set<string>>(...)

// After:
const [visibleTypes, setVisibleTypes] = useState<string[]>([]);

// Toggle becomes:
const handleToggleType = useCallback((name: string) => {
  setVisibleTypes(prev => 
    prev.includes(name) 
      ? prev.filter(n => n !== name) 
      : [...prev, name]
  );
}, []);

// Check becomes:
visibleTypes.includes(t.name) instead of visibleTypes.has(t.name)
```

---

#### Issue 3: Add Process Duration Handling

In `src/lib/durationCalculator.ts`, add to `calculateSystemOrAssetDates`:

```typescript
// Processes - span entire construction period
else if (name === "Contractor Team" || name === "Water Mitigation Vendor Process" || 
         name === "Mechanical Contractor Process" || name === "Engineering Process") {
  if (timeline.construction_start_date && timeline.construction_end_date) {
    startDate = parseISO(timeline.construction_start_date);
    endDate = parseISO(timeline.construction_end_date);
    calculatedFrom = "Construction start to Construction end";
  }
}
```

---

#### Issue 4: Fix Control ID Parsing

In `useRiskTimelineData.ts`, parse control name from composite ID:

```typescript
// Before:
const normalizedControlId = controlId.toLowerCase().trim();
const points = controlPointsLookup.get(normalizedControlId) || 0;

// After:
// Extract control name from composite ID (format: "instanceId::controlName")
const controlName = controlId.includes('::') 
  ? controlId.split('::')[1] 
  : controlId;
const normalizedControlName = controlName.toLowerCase().trim();
const points = controlPointsLookup.get(normalizedControlName) || 0;
```

---

#### Issue 5: Cost View Toggle

1. Add new interface for cost data:
```typescript
interface CostTimelineDataInput extends RiskTimelineDataInput {
  controlCosts?: Array<{ name: string; oneTimeCost: number; monthlyCost: number }>;
  pricingTiers?: PricingTier[];
}

interface RiskTimelineData {
  // ... existing fields
  costMatrix?: number[][];  // Monthly costs per ASP class
  totalCostPerMonth?: number[];
}
```

2. Add toggle in ControlPanel:
```typescript
<div className="flex items-center gap-1.5">
  <Label className="text-xs text-muted-foreground">Data:</Label>
  <ToggleGroup type="single" value={settings.dataType} onValueChange={...}>
    <ToggleGroupItem value="risk">Risk Points</ToggleGroupItem>
    <ToggleGroupItem value="cost">Cost ($)</ToggleGroupItem>
  </ToggleGroup>
</div>
```

3. Calculate monthly costs per ASP class based on selected controls, using `calculateTieredControlCost`.

4. When `dataType === 'cost'`, use `costMatrix` instead of `matrix`.

---

#### Issue 6 & 7: 3D Y-Axis with Labels

Add a new component `YAxisMesh`:

```typescript
const YAxisMesh: React.FC<{ maxValue: number; scaleY: number }> = ({ maxValue, scaleY }) => {
  // Calculate nice tick values (e.g., 0, 100, 200, 300, 400)
  const tickInterval = Math.ceil(maxValue / 5 / 50) * 50; // Round to nearest 50
  const ticks = [];
  for (let v = 0; v <= maxValue; v += tickInterval) {
    ticks.push(v);
  }
  
  return (
    <group position={[-0.5, 0, 0]}>
      {/* Y-axis line */}
      <Line points={[[0, 0, 0], [0, maxValue * scaleY, 0]]} color="#666" lineWidth={2} />
      
      {/* Tick marks and labels */}
      {ticks.map(v => (
        <group key={v} position={[0, v * scaleY, 0]}>
          <Line points={[[-0.1, 0, 0], [0.1, 0, 0]]} color="#666" lineWidth={1} />
          <Text position={[-0.3, 0, 0]} fontSize={0.15} color="#666" anchorX="right">
            {v}
          </Text>
        </group>
      ))}
      
      {/* Y-axis label */}
      <Text 
        position={[-0.8, maxValue * scaleY / 2, 0]} 
        rotation={[0, 0, Math.PI / 2]}
        fontSize={0.2} 
        color="#444"
      >
        Risk Points
      </Text>
    </group>
  );
};
```

---

### Implementation Order

1. **Issue 4**: Fix control ID parsing (critical for derisk to work)
2. **Issue 3**: Add Process duration handling
3. **Issue 1**: Dynamic Y-axis scaling for 3D
4. **Issue 2**: Convert visibleTypes to array
5. **Issues 6 & 7**: Add Y-axis visualization with labels
6. **Issue 5**: Add cost view toggle

---

### UI Mockup

After implementation, the control panel will look like:

```
View: [3D|2D] | Mode: [Total|By Type] | Style: [Line|Bars|...] | Data: [Risk|Cost] | From: [____] To: [____] | [⛶]
```

The 3D chart will have:
- Visible Y-axis on the left with tick marks
- Label "Risk Points" or "Cost ($)" based on selected data type
- Dynamic scaling so Total mode doesn't overflow

