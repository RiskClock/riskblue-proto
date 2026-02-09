

## Fix: Selection Reset and Checkbox Inconsistency

### Root Cause

The initialization logic in all three step components has a critical gap:

1. It only adds missing **controls** but does NOT add missing **instances**
2. Our recent control-gap fix made this worse by adding controls for 7 instances that aren't in the selected instances list
3. This creates a state where `selectedControlIds` has entries like `ERM004::Presence of Water Monitoring` but `ERM004` is not in `selectedInstanceIds`
4. The checkbox logic then shows indeterminate (minus icon) for these instances because `!isInstanceSelected && hasAnyControlSelected` is true

### Current Data State

| Data Source | Count |
|---|---|
| Analysis items (Assets) | 27 |
| Saved selectedAssetInstances | 20 (missing 7) |
| Saved selectedAssetControls | 33 (includes controls for the 7 missing instances) |

### Fix

Update the initialization logic in all three step components to detect and add missing **instances** alongside missing controls.

**Files to modify:**
- `src/components/wizard/CriticalAssetsStep.tsx`
- `src/components/wizard/WaterSystemsStep.tsx`
- `src/components/wizard/ProcessesStep.tsx`

### Implementation

In the initialization `useEffect` of each step, after the existing instance initialization check (`if (!data.selected*Instances || length === 0`), add an `else` branch that detects missing instances:

```typescript
// Current: only initializes if empty
if (!data.selectedAssetInstances || data.selectedAssetInstances.length === 0) {
  instanceIds = assetItems.map(i => i.id);
  // ...
} else {
  // NEW: detect missing instances from analysisItems
  const allExpectedInstanceIds = assetItems.map(i => i.id);
  const currentSavedInstances = new Set(data.selectedAssetInstances);
  const missingInstances = allExpectedInstanceIds.filter(
    id => !currentSavedInstances.has(id)
  );
  if (missingInstances.length > 0) {
    instanceIds = [...currentSavedInstances, ...missingInstances];
    setSelectedInstanceIds(instanceIds);
    lastSavedRef.current.instances = instanceIds;
    shouldPersist = true;
  }
}
```

This ensures that when new analysis items appear (or if instances were lost), they get automatically added to the selection -- consistent with the existing behavior for controls.

The same pattern applies to all three step components with their respective field names (`selectedSystemInstances`, `selectedProcessInstances`).

### Expected Result

| Scenario | Before Fix | After Fix |
|---|---|---|
| Missing instances in saved data | Instances stay missing, controls show for unselected items | Missing instances auto-added |
| Checkbox state | Indeterminate for items with controls but no instance selection | Fully checked (instance + controls both selected) |
| New analysis items added | Not picked up unless list was empty | Auto-detected and added |

