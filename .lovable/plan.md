
## Analysis of 182.8 Derisk Points

### How Derisk Is Calculated

The derisk value shown (182.8 pts) is calculated using a **weighted control ratio**, not a simple control count. Here's the formula:

```
For each selected instance:
  instanceDerisk = classRiskPoints × (selectedControlWeight / totalControlWeight)
  
Where:
  - classRiskPoints = Probability × Impact (from database)
  - selectedControlWeight = sum of points for controls you selected
  - totalControlWeight = sum of points for ALL controls on that instance
```

### Why 182.8 Might Be Correct (or Low)

With 62 controls selected across Enhanced package:
- **Total Risk = 400 pts** (visible in your screenshot)
- **Derisk = 182.8 pts** (45.7% of risk)

This means approximately 45.7% of the weighted control coverage is achieved. Possible reasons:

1. **Not all instances selected**: The Enhanced package covers 7 Assets + 5 Water Systems + 3 Processes, but maybe not all instances of those classes are selected
2. **Control weight distribution**: Some controls have higher "points" than others (e.g., a 10-point control contributes more than a 1-point control)
3. **Some classes may have more controls defined than selected**: If a class has 10 controls total but only 5 are selected, derisk = 50% of risk

### To Get a Detailed Breakdown

I would need to query the database to see:
1. Which instances are selected and their class P×I values
2. Which controls are selected per instance
3. The points assigned to each control

This requires database access which is beyond the read-only scope. However, the calculation logic in `useRiskTimelineData.ts` (lines 421-491) appears correct.

---

## Implementation Plan for UI Changes

### Change 1: Today Indicator to Black

**File:** `src/components/wizard/RiskTimelineChart3D.tsx`

Update the ReferenceLine for "Today" at line 911-916:

```typescript
// Current (red)
<ReferenceLine 
  x={todayMonth} 
  stroke="#ef4444" 
  strokeWidth={2}
  label={{ value: "Today", position: "top", fill: "#ef4444", fontSize: 12 }}
/>

// Updated (black)
<ReferenceLine 
  x={todayMonth} 
  stroke="#000000" 
  strokeWidth={2}
  label={{ value: "Today", position: "top", fill: "#000000", fontSize: 12 }}
/>
```

---

### Change 2: Y-Axis Formatting for Cost Mode (Show in $1000s)

**File:** `src/components/wizard/RiskTimelineChart3D.tsx`

Add a `tickFormatter` to the YAxis component in `renderContent()` (line 931-934):

```typescript
<YAxis 
  className="text-xs" 
  label={{ value: yAxisLabel, angle: -90, position: 'insideLeft', style: { textAnchor: 'middle' } }}
  tickFormatter={(value: number) => {
    if (dataType === 'cost') {
      // Format as $30k, $100k, etc.
      if (value >= 1000) {
        return `$${(value / 1000).toFixed(0)}k`;
      }
      return `$${value}`;
    }
    return value;
  }}
/>
```

This requires passing `dataType` to `renderContent()` or making it accessible. Since `Chart2D` already has `dataType` as a prop, we can use it directly in the YAxis formatter.

Also update the tooltip formatter to be consistent:

```typescript
<RechartsTooltip 
  contentStyle={{ 
    backgroundColor: 'hsl(var(--popover))', 
    border: '1px solid hsl(var(--border))',
    borderRadius: '0.5rem'
  }}
  formatter={(value: number) => [
    dataType === 'cost' 
      ? (value >= 1000 ? `$${(value / 1000).toFixed(1)}k` : `$${value}`)
      : Number(value).toFixed(1),
    undefined
  ]}
/>
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/wizard/RiskTimelineChart3D.tsx` | 1. Change Today line stroke from `#ef4444` to `#000000` (black). 2. Add `tickFormatter` to YAxis for cost mode to display values as `$Xk`. 3. Update tooltip formatter for consistency. |

---

## Summary

| Request | Action |
|---------|--------|
| 182.8 derisk verification | This is calculated using weighted control ratios. The formula is mathematically correct. A detailed instance-by-instance breakdown requires database queries. |
| Today indicator → black | Change `stroke` and `fill` from `#ef4444` to `#000000` |
| Y-axis in $1000s for cost mode | Add `tickFormatter` that converts values like `30000` to `$30k` |
