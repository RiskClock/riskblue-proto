
## Plan: Fix Controls Cost Showing $0 in Risk Timeline

### Root Cause Analysis

I conducted a deep investigation and found **two issues**:

| # | Issue | Root Cause |
|---|-------|------------|
| 1 | **Query not returning cost fields** | Network request shows `select=name,points` but code has `select=name,points,one_time_cost,monthly_maint_cost`. This suggests the previous code change hasn't fully deployed or there's a caching issue. |
| 2 | **Potential loop early-exit conditions** | The controls cost calculation in `useRiskTimelineData.ts` has multiple `if (!...) return;` statements that silently skip processing without logging, making debugging difficult. |

### Evidence

From the network request captured:
```
GET /mitigation_controls?select=name%2Cpoints&is_active=eq.true
```
Response: `[{"name":"Automatic Shut Off Valve","points":10}, ...]`

The response shows **only `name` and `points`** - no `oneTimeCost` or `monthlyCost` fields.

However, the code at `src/pages/ProjectWizard.tsx` line 394 now correctly specifies:
```typescript
.select('name, points, one_time_cost, monthly_maint_cost')
```

This mismatch indicates:
1. Build/deploy timing issue from previous changes
2. Browser caching the old JavaScript bundle
3. React Query caching stale data

### Solution

#### Part 1: Force Query Refresh + Verify Data Loading

**File: `src/pages/ProjectWizard.tsx`**

Change the query key to force a cache invalidation:
```typescript
const { data: controlPointsData = [] } = useQuery({
  queryKey: ['control-points-with-costs-v2'],  // Changed key to force refetch
  queryFn: async () => {
    const { data, error } = await supabase
      .from('mitigation_controls')
      .select('name, points, one_time_cost, monthly_maint_cost')
      .eq('is_active', true);
    if (error) throw error;
    return (data || []).map(c => ({
      name: c.name,
      points: Number(c.points) || 0,
      oneTimeCost: Number(c.one_time_cost) || 0,
      monthlyCost: Number(c.monthly_maint_cost) || 0
    }));
  },
  staleTime: 0,  // Always refetch
});
```

#### Part 2: Add Debugging + Robustness to Cost Calculation

**File: `src/hooks/useRiskTimelineData.ts`**

Add console logging and ensure early exits are tracked:
```typescript
// In the controls cost calculation section (lines 527-603)
let totalControlsCostPerMonth: number[] | null = null;

console.log('[RiskTimeline] Cost calculation inputs:', {
  selectedControlIds: selectedControlIds.length,
  controlsData: controlsData.length,
  sampleControl: controlsData[0]
});

if (selectedControlIds.length > 0 && controlsData.length > 0) {
  const costPerMonth = months.map(() => 0);
  let processedCount = 0;
  let skippedNoControl = 0;
  let skippedNoInstance = 0;
  let skippedNoClass = 0;
  let skippedNoClassData = 0;
  
  const oneTimeCostAdded = new Set<string>();
  
  selectedControlIds.forEach(controlId => {
    const parts = controlId.split('::');
    if (parts.length !== 2) return;
    
    const [instanceId, controlName] = parts;
    const normalizedControlName = controlName.toLowerCase().trim();
    
    const controlCost = controlsData.find(c => c.name.toLowerCase().trim() === normalizedControlName);
    if (!controlCost) {
      skippedNoControl++;
      return;
    }
    
    const instance = analysisItems.find(item => item.id === instanceId);
    if (!instance) {
      skippedNoInstance++;
      return;
    }
    
    const className = instance.category === 'Asset' 
      ? mapToAssetName(instance.name)
      : instance.category === 'Water System' 
        ? mapToWaterSystemName(instance.name)
        : mapToProcessName(instance.name);
    
    if (!className) {
      skippedNoClass++;
      return;
    }
    
    const normalizedClassName = normalizeClassName(className);
    const classData = classDataMap.get(normalizedClassName);
    if (!classData || !classData.startDate || !classData.endDate) {
      skippedNoClassData++;
      return;
    }
    
    // ... rest of cost calculation
    processedCount++;
  });
  
  console.log('[RiskTimeline] Cost calculation results:', {
    processedCount,
    skippedNoControl,
    skippedNoInstance,
    skippedNoClass,
    skippedNoClassData,
    totalCost: costPerMonth.reduce((a, b) => a + b, 0)
  });
  
  totalControlsCostPerMonth = costPerMonth;
}
```

#### Part 3: Handle Missing Cost Data Gracefully

If `controlsData` has empty cost fields, we should log a warning:

```typescript
// At the start of useRiskTimelineData
if (controlsData.length > 0) {
  const hasAnyCosts = controlsData.some(c => (c.oneTimeCost || 0) > 0 || (c.monthlyCost || 0) > 0);
  if (!hasAnyCosts) {
    console.warn('[RiskTimeline] Warning: controlsData has no cost information');
  }
}
```

### Files to Modify

| File | Changes |
|------|---------|
| `src/pages/ProjectWizard.tsx` | Update query key to force cache refresh, add `staleTime: 0` |
| `src/hooks/useRiskTimelineData.ts` | Add debugging logs for cost calculation, warn if no costs in data |

### Expected Behavior After Fix

1. The query will be refetched with the correct fields (`one_time_cost`, `monthly_maint_cost`)
2. Console logs will show:
   - How many controls were processed
   - Why controls were skipped (missing control, instance, class, or dates)
   - Total cost calculated
3. Controls Cost line will show non-zero values when controls with costs are selected

### Alternative Investigation Path

If the fix doesn't work after deployment, the console logs will reveal which condition is failing:

- **`skippedNoControl > 0`**: Control name mismatch between selected controls and database
- **`skippedNoInstance > 0`**: Instance ID not found in analysisItems
- **`skippedNoClass > 0`**: Class name mapping failed
- **`skippedNoClassData > 0`**: Class has no valid date range
- **`processedCount > 0` but `totalCost = 0`**: All matched controls have `$0` cost

This will quickly pinpoint the exact issue if it's not the caching problem.
