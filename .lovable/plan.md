

## Fix: Missing Instance Detection in All Three Step Components

### Problem

The initialization `useEffect` in `CriticalAssetsStep`, `WaterSystemsStep`, and `ProcessesStep` has a gap:

- It detects and adds missing **controls** (has an `else` branch for this)
- It does NOT detect missing **instances** -- only initializes them when the list is completely empty

### Current Database State (for project 175bb9c9)

- 27 Asset analysis items exist in `project_analysis_items`
- `selectedAssetInstances` only has 24 (missing ERM001, ERM004, ERM005)
- `selectedAssetControls` includes controls for those 3 missing instances (added by the controls gap-fix)
- Result: checkboxes show indeterminate (minus icon) because controls exist for unselected instances

### Fix

Add an `else` branch after the instance initialization check in all three files to detect and re-add missing instances:

**Files to modify:**
- `src/components/wizard/CriticalAssetsStep.tsx` (after line 293)
- `src/components/wizard/WaterSystemsStep.tsx` (after line 276)
- `src/components/wizard/ProcessesStep.tsx` (same pattern)

### Implementation Detail

In each file's initialization `useEffect`, change the instance initialization block from:

```typescript
if (!data.selectedAssetInstances || data.selectedAssetInstances.length === 0) {
  instanceIds = assetItems.map(i => i.id);
  setSelectedInstanceIds(instanceIds);
  lastSavedRef.current.instances = instanceIds;
  shouldPersist = true;
}
```

To:

```typescript
if (!data.selectedAssetInstances || data.selectedAssetInstances.length === 0) {
  instanceIds = assetItems.map(i => i.id);
  setSelectedInstanceIds(instanceIds);
  lastSavedRef.current.instances = instanceIds;
  shouldPersist = true;
} else {
  // Detect and add missing instances (e.g., from new analysis items or data drift)
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

The same pattern applies with `selectedSystemInstances` and `selectedProcessInstances` for the other two files.

### Expected Result

| Scenario | Before | After |
|---|---|---|
| Instances missing from saved data | Stay missing, controls show for unselected items | Auto-detected and re-added |
| Checkbox state | Indeterminate (minus icon) | Fully checked |
| New analysis items added after initial save | Not picked up | Auto-added to selection |
