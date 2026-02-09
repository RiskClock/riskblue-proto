

## Fix: Stop Re-Adding Intentionally Deselected Items

### Root Cause

The "missing instance detection" logic added in the last diff treats every analysis item not in `selectedAssetInstances` as "missing" and re-adds it. But when a user intentionally unchecks ERM001, ERM004, ERM005, those IDs are correctly removed from `selectedAssetInstances`. On reload, the code sees them as "missing" and adds them back -- resetting the user's selections.

The same problem exists for controls: the `else` branch for controls re-adds any control not in `selectedAssetControls`, overriding intentional deselections.

### Solution

Remove the "missing instance" and "missing control" detection `else` branches entirely. They were added to fix the original checkbox inconsistency bug, but that bug's real fix is a **one-time data repair**, not ongoing re-addition logic.

Instead:
1. **Remove** the `else` branches that re-add missing instances and controls in all three step components
2. **Add a one-time data repair** that runs only when the specific data drift condition is detected (controls exist for instances not in the selection list), fixes it, and marks it as repaired so it never runs again

### Implementation

**Files to modify:**
- `src/components/wizard/CriticalAssetsStep.tsx`
- `src/components/wizard/WaterSystemsStep.tsx`
- `src/components/wizard/ProcessesStep.tsx`

**Step 1: Remove the problematic `else` branches**

In all three files, remove the `else` block after the instance initialization that detects "missing instances":

```typescript
// REMOVE this else block in all three files:
} else {
  const allExpectedInstanceIds = assetItems.map(i => i.id);
  const currentSavedInstances = new Set<string>(data.selectedAssetInstances);
  const missingInstances = allExpectedInstanceIds.filter(id => !currentSavedInstances.has(id));
  if (missingInstances.length > 0) {
    instanceIds = [...currentSavedInstances, ...missingInstances];
    setSelectedInstanceIds(instanceIds);
    lastSavedRef.current.instances = instanceIds;
    shouldPersist = true;
  }
}
```

Also remove the equivalent `else` block for controls that re-adds "missing controls."

**Step 2: Add orphan control cleanup**

Instead of re-adding missing instances, clean up orphaned controls (controls whose parent instance is not selected). This runs during initialization to fix the inconsistency without overriding user intent:

```typescript
// After setting instanceIds and controlIds, clean up orphaned controls
if (data.selectedAssetControls && data.selectedAssetControls.length > 0 
    && data.selectedAssetInstances && data.selectedAssetInstances.length > 0) {
  const instanceSet = new Set<string>(instanceIds);
  const cleanedControls = controlIds.filter(controlId => {
    // Control IDs are formatted as "instanceId::controlName"
    const instanceId = controlId.split("::")[0];
    return instanceSet.has(instanceId);
  });
  if (cleanedControls.length !== controlIds.length) {
    controlIds = cleanedControls;
    setSelectedControlIds(new Set<string>(cleanedControls));
    lastSavedRef.current.controls = cleanedControls;
    shouldPersist = true;
  }
}
```

This approach:
- Preserves user's intentional deselections (no re-adding)
- Fixes the checkbox inconsistency by removing orphaned controls rather than re-adding missing instances
- Only modifies data when there's a genuine inconsistency (controls without parent instances)

### Expected Result

| Scenario | Before | After |
|---|---|---|
| User unchecks ERM001, ERM004, ERM005 and reopens | All re-selected (reset) | Stay unchecked |
| Orphaned controls (controls for unselected instances) | Cause indeterminate checkboxes | Cleaned up on load |
| Brand new project (empty selections) | All selected by default | All selected by default (unchanged) |

