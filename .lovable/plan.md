

## Fix: Package Cost Ignores Instance Selections

### Root Cause

The `totalCostEstimates` calculation iterates over **all** analysis items regardless of whether they are selected. It does not filter by `selectedAssetInstances`, `selectedSystemInstances`, or `selectedProcessInstances`. This means the "package cost" shown initially ($615,536) includes costs for instances the user previously deselected -- it was never the correct number.

When `hasManualOverride` switches to `true`, the display switches to `actualSelectedCost`, which correctly only counts selected controls. This creates the illusion that rechecking doesn't restore the original value, when in reality the original value was inflated.

### Numbers Explained

- **$615,536** = package cost counting ALL instances (including deselected ones) -- overcounted
- **$575,276** = actual cost of currently selected instances/controls -- correct
- **$539,176** = $575,276 minus the unchecked $36.1K ASP -- correct
- The $40,260 gap ($615,536 - $575,276) represents the cost of previously deselected instances that `totalCostEstimates` was incorrectly including

### Solution

Filter `totalCostEstimates` to only include selected instances when processing each category. This ensures the package cost matches `actualSelectedCost` when all controls for selected instances are checked.

### Files to modify

- `src/pages/ProjectWizard.tsx`

### Implementation

In the `totalCostEstimates` useMemo, before calling `processInstances` for each class group, filter instances to only those present in the corresponding selection arrays:

```text
// When processing assets:
const selectedAssetSet = new Set(projectData.selectedAssetInstances || []);
assetsByClass.forEach((instances, className) => {
  const selectedInstances = instances.filter(i => selectedAssetSet.has(i.id));
  if (selectedInstances.length === 0) return;
  // ... process selectedInstances instead of instances
});

// Same pattern for water systems (selectedSystemInstances) and processes (selectedProcessInstances)
```

Add `projectData.selectedAssetInstances`, `projectData.selectedSystemInstances`, and `projectData.selectedProcessInstances` to the useMemo dependency array.

If none of the selection arrays exist yet (brand new project, no saved data), fall back to including all instances (current behavior).

### Expected Result

| Scenario | Before | After |
|---|---|---|
| Initial load (some instances previously deselected) | $615,536 (inflated) | $575,276 (correct, matches selected instances) |
| Uncheck $36.1K ASP | $539,176 | $539,176 (same) |
| Recheck ASP | $575,276 | $575,276 (matches initial display) |

