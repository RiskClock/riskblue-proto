
## Fix One-Time Costs to Apply at Control Start Dates

### Root Cause
The current cost calculation (lines 320-370 in `useRiskTimelineData.ts`) aggregates ALL one-time costs from selected controls and applies them to the first month of each class's schedule. This creates a single large spike at project start (May 2023) rather than distributing one-time costs to when each control actually comes online.

**Current behavior:**
```
Month 1: $70.2k (all one-time costs lumped together)
Month 2+: $X (ongoing monthly costs)
```

**Desired behavior:**
```
Month 1: $1.2k (one-time cost for Control A) + ongoing
Month 2: $0.8k (one-time cost for Control B) + ongoing
Month 3: $2.4k (one-time cost for Control C) + ongoing
```

### Why This Matters
- **Visibility**: Shows when capital expenditures actually occur during construction
- **Planning**: Helps identify cost concentration periods and cash flow needs
- **Accuracy**: Reflects actual control implementation timelines

### Solution Approach

**File: `src/hooks/useRiskTimelineData.ts`**

Refactor the `calculateCostMatrix()` function (lines 323-370) to:

1. **Build a control-to-instance mapping** instead of aggregating all costs upfront
   - For each `selectedControlId` (format: `instanceId::controlName`), extract the instance and control separately
   - Track which one-time and monthly costs belong to each instance

2. **Calculate per-instance costs** based on the instance's actual schedule
   - For each instance in a class: get its start date (use class start date as fallback)
   - Apply selected controls' one-time costs only in the first month that instance is active
   - Apply monthly costs to all months the instance is active

3. **Distribute costs proportionally across instances**
   - If a class has 3 selected instances, divide that class's row cost across those 3 instances
   - This preserves the proportional distribution while respecting individual schedules

### Technical Implementation

Replace the current `calculateCostMatrix()` logic (lines 323-336) with:

```typescript
// Build control-to-instance lookup: instanceId -> { oneTimeCost, monthlyCost }
const controlsByInstance = new Map<string, { oneTimeCost: number; monthlyCost: number }>();

selectedControlIds.forEach(controlId => {
  const parts = controlId.split('::');
  if (parts.length !== 2) return;
  
  const [instanceId, controlName] = parts;
  const normalizedName = controlName.toLowerCase().trim();
  const costs = controlCostLookup.get(normalizedName);
  
  if (!costs) return;
  
  if (!controlsByInstance.has(instanceId)) {
    controlsByInstance.set(instanceId, { oneTimeCost: 0, monthlyCost: 0 });
  }
  
  const instanceCosts = controlsByInstance.get(instanceId)!;
  instanceCosts.oneTimeCost += costs.oneTimeCost;
  instanceCosts.monthlyCost += costs.monthlyCost;
});
```

Then in the row calculation (lines 344-366), for each class:
- Iterate through `classData.instanceIds` 
- For each instance that's in `controlsByInstance`, apply its one-time cost at the start of its schedule
- Distribute monthly costs across all months

### Files to Modify

| File | Section | Change |
|------|---------|--------|
| `src/hooks/useRiskTimelineData.ts` | Lines 323-370 in `calculateCostMatrix()` | Refactor to map controls to instances and apply one-time costs at individual instance start dates instead of aggregating |

### Expected Result After Fix

- One-time costs appear at the beginning of each control's implementation period
- Spike is eliminated or reduced (depending on how many controls start in Month 1)
- Remaining spikes correspond to when multiple controls are scheduled to start in the same month
- Monthly costs continue as before throughout the control duration

### Data Flow Visualization

```
Before:
  Class A: [70.2k, 2.5k, 2.5k, 2.5k, ...]
  
After:
  Class A: [1.2k+0.8k+1.5k, 2.5k, 2.5k, 2.5k, ...]
           = [3.5k, 2.5k, 2.5k, 2.5k, ...]
  (if 3 controls start in Month 1)
```

