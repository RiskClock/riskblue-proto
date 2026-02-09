

## Fix: Cost Estimate Flickering on Checkbox Toggle

### Root Cause

There is a **timing mismatch** between when `hasManualOverride` switches to `true` and when `projectData` actually reflects the new selections.

Here is the sequence when a user unchecks an instance:

1. **T=0ms**: `handleInstanceCheckboxClick` fires. It:
   - Updates local state in the step component (`selectedInstanceIds`, `selectedControlIds`)
   - Calls `onManualControlToggle()` which sets `hasManualOverride = true` **immediately** in ProjectWizard
2. **T=0ms**: ProjectWizard re-renders. The cost display switches from **package cost** (`totalCostEstimates`) to **`actualSelectedCost`**. But `actualSelectedCost` reads from `projectData.selectedProcessControls` which **has not been updated yet** (still has old values) -- showing the wrong intermediate cost.
3. **T=500ms**: The step component's debounced auto-save fires, calling `updateFields()` which updates `projectData`. Now `actualSelectedCost` recalculates with the correct controls -- showing the final cost.

This explains:
- **$615,536** = package cost (before `hasManualOverride`)
- **$575,276** = `actualSelectedCost` with stale `projectData` (intermediate)
- **$539,176** = `actualSelectedCost` with updated `projectData` (correct)

When rechecking, `hasManualOverride` is already `true`, so you see `actualSelectedCost` with stale data ($575,276) instead of the package cost.

### Solution

**Eliminate the 500ms delay** by calling `updateFields` immediately when toggling checkboxes, instead of waiting for the debounced auto-save. This ensures `projectData` and `actualSelectedCost` are in sync the moment `hasManualOverride` switches.

### Files to modify
- `src/components/wizard/CriticalAssetsStep.tsx`
- `src/components/wizard/WaterSystemsStep.tsx`
- `src/components/wizard/ProcessesStep.tsx`

### Implementation

In each step component, update `handleToggleControl`, `handleToggleAllControls`, `handleToggleInstance`, and `handleToggleAll` to immediately call `updateFields` with the new selection state (in addition to updating local state). Also update `lastSavedRef` so the debounced auto-save detects no change and skips.

For example in `ProcessesStep.tsx`:

```typescript
const handleToggleInstance = useCallback((instanceId: string) => {
  setSelectedInstanceIds(prev => {
    const next = prev.includes(instanceId)
      ? prev.filter(id => id !== instanceId)
      : [...prev, instanceId];
    // Immediately sync to projectData (bypass debounce)
    updateFields({ selectedProcessInstances: next });
    lastSavedRef.current.instances = next;
    return next;
  });
}, [updateFields]);

const handleToggleAll = useCallback((instanceIds: string[], selected: boolean) => {
  setSelectedInstanceIds(prev => {
    const next = selected
      ? Array.from(new Set([...prev, ...instanceIds]))
      : prev.filter(id => !instanceIds.includes(id));
    updateFields({ selectedProcessInstances: next });
    lastSavedRef.current.instances = next;
    return next;
  });
}, [updateFields]);

const handleToggleControl = useCallback((controlId: string) => {
  setSelectedControlIds(prev => {
    const next = new Set(prev);
    if (next.has(controlId)) {
      next.delete(controlId);
    } else {
      next.add(controlId);
    }
    const arr = Array.from(next);
    updateFields({ selectedProcessControls: arr });
    lastSavedRef.current.controls = arr;
    return next;
  });
  if (!isRiskToleranceUpdateRef.current && onManualControlToggle) {
    onManualControlToggle();
  }
}, [onManualControlToggle, updateFields]);

const handleToggleAllControls = useCallback((controlIds: string[], selected: boolean) => {
  setSelectedControlIds(prev => {
    const next = new Set(prev);
    controlIds.forEach(id => {
      if (selected) next.add(id); else next.delete(id);
    });
    const arr = Array.from(next);
    updateFields({ selectedProcessControls: arr });
    lastSavedRef.current.controls = arr;
    return next;
  });
  if (!isRiskToleranceUpdateRef.current && onManualControlToggle) {
    onManualControlToggle();
  }
}, [onManualControlToggle, updateFields]);
```

The same pattern applies to `CriticalAssetsStep` (using `selectedAssetInstances`/`selectedAssetControls`) and `WaterSystemsStep` (using `selectedSystemInstances`/`selectedSystemControls`).

The debounced auto-save `useEffect` remains as a safety net but will typically detect no changes since `lastSavedRef` is already up to date.

### Expected Result

| Scenario | Before | After |
|---|---|---|
| Uncheck instance | Cost flickers through 2 values over 500ms | Cost updates to correct value instantly |
| Recheck instance | Shows stale intermediate cost | Shows correct cost instantly |
| Rapid toggles | Multiple delayed recalculations | Each toggle immediately reflected |

