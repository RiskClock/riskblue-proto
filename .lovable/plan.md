

## Bug Analysis: ASP Instance Selections Reset on Navigation

### Root Cause Identified

When users navigate away from the project page and return, their custom instance/control selections are being overwritten. This happens in **three components**:

- `src/components/wizard/CriticalAssetsStep.tsx`
- `src/components/wizard/WaterSystemsStep.tsx`
- `src/components/wizard/ProcessesStep.tsx`

### The Problem Flow

1. User makes custom selections (e.g., unchecks some instances/controls)
2. Selections are saved to database via `updateFields()` (confirmed working - data is in DB)
3. User navigates away (to Projects list, etc.)
4. User navigates back to the project
5. Step components **remount**, causing `prevRiskToleranceRef.current` to reset to `null`
6. The risk tolerance filtering effect runs because `null !== parentRiskTolerance`
7. The effect **overwrites** the user's saved selections with freshly filtered selections based on the current package

### Evidence

Database query confirms saved data exists:
```
selected_asset_instances: [KW014, FEER001, MTM001, ERM001, ...]  (27 items)
selected_process_instances: [CONT001, WMVP001, MCP001]  (3 items)
selected_system_instances: [FS001, TWR001, DCW001, ...]  (9 items)
```

But on remount, the filtering effect (lines 352-401 in CriticalAssetsStep) runs and recalculates selections.

---

## Solution

The fix is to **skip the risk tolerance filtering on initial mount if the user already has saved selections**. This preserves their manual customizations while still allowing the package selector to work when the user actively changes it.

### Technical Changes

**Files to modify:**
1. `src/components/wizard/CriticalAssetsStep.tsx`
2. `src/components/wizard/WaterSystemsStep.tsx`
3. `src/components/wizard/ProcessesStep.tsx`

**Change in each file:**

Modify the risk tolerance filtering useEffect to check if there are existing saved selections before applying the package filter on initial mount:

```typescript
// BEFORE (problematic):
useEffect(() => {
  if (!assetItems.length || !controls.length) return;
  
  // Run on initial load (when prevRef is null) OR when tolerance actually changes
  if (prevRiskToleranceRef.current === parentRiskTolerance) return;
  prevRiskToleranceRef.current = parentRiskTolerance;
  
  // ... filters and overwrites selections
}, [parentRiskTolerance, ...]);

// AFTER (fixed):
useEffect(() => {
  if (!assetItems.length || !controls.length) return;
  
  // Skip if tolerance hasn't changed
  if (prevRiskToleranceRef.current === parentRiskTolerance) return;
  
  const isInitialMount = prevRiskToleranceRef.current === null;
  prevRiskToleranceRef.current = parentRiskTolerance;
  
  // On initial mount, PRESERVE existing saved selections instead of re-filtering
  // Only apply package filtering when user actively changes the tolerance
  if (isInitialMount) {
    const existingInstances = data.selectedAssetInstances || [];
    const existingControls = data.selectedAssetControls || [];
    
    // If user has saved selections, preserve them and don't re-filter
    if (existingInstances.length > 0 || existingControls.length > 0) {
      return;
    }
  }
  
  // ... rest of filtering logic for when tolerance actually changes
}, [parentRiskTolerance, ...]);
```

### Why This Works

- **On initial mount with existing data**: The effect sees `isInitialMount = true` and `existingInstances.length > 0`, so it returns early without overwriting
- **On initial mount without data**: The effect applies the package filter to initialize selections (new project behavior)
- **On package change**: The effect runs normally because `isInitialMount = false`, allowing the user to switch packages

### Additional Safeguard

Also add a check to the local state initialization (around line 76-83) to ensure it reads from `data` on every mount:

```typescript
// Current local state initialization
const [selectedInstanceIds, setSelectedInstanceIds] = useState<string[]>(
  data.selectedAssetInstances || []
);
```

This is correct but we should also sync on remount using an effect:

```typescript
// Sync local state from saved data on mount
useEffect(() => {
  if (data.selectedAssetInstances && data.selectedAssetInstances.length > 0) {
    setSelectedInstanceIds(data.selectedAssetInstances);
    setSelectedControlIds(new Set(data.selectedAssetControls || []));
  }
}, []); // Run once on mount
```

---

## Summary

| Issue | Fix |
|-------|-----|
| Risk tolerance effect runs on remount and overwrites saved selections | Check for existing saved data and skip filtering on initial mount |
| Applies to 3 components | CriticalAssetsStep, WaterSystemsStep, ProcessesStep |
| User-visible behavior after fix | Navigating away and back preserves all custom selections |

