
# Fix: AWPEditModal "Select All" Bug on Item Edit

## Root Cause

In `src/pages/ProjectWizard.tsx` lines 1943-1965, the `onUpdateItems` callback (fired when the AWP Edit Modal saves) has this code:

```typescript
// Auto-select all new items and their controls so they appear in PDF export
const assetInstances = items.filter(i => i.category === "Asset").map(i => i.id);
const systemInstances = items.filter(i => i.category === "Water System").map(i => i.id);
const processInstances = items.filter(i => i.category === "Process").map(i => i.id);
// ...builds ALL controls...
updateFields({
    selectedAssetInstances: assetInstances,
    selectedAssetControls: assetControls,
    selectedWaterSystemInstances: systemInstances,
    ...
});
```

This **replaces** all selections with every single item, regardless of what the user had previously selected. Even editing one water system pipe diameter triggers this code, causing every critical asset instance to become selected.

Additionally, it writes to the **legacy key** `selectedWaterSystemInstances` instead of the canonical `selectedSystemInstances`, creating a data inconsistency.

## Fix

**File: `src/pages/ProjectWizard.tsx` (lines 1943-1965)**

Replace the unconditional "select all" logic with a **merge** approach that:

1. Preserves existing selections for items that still exist
2. Auto-selects only truly NEW items (items whose IDs were not in the previous `analysisItems` list)
3. Uses the canonical key names (`selectedSystemInstances` / `selectedSystemControls`) instead of the legacy `selectedWaterSystem*` keys

The updated logic:

```text
1. Capture the set of OLD item IDs (from the analysisItems state BEFORE the update)
2. For each category (Asset, Water System, Process):
   a. Get current saved selections from projectData
   b. Remove any selections for items that were DELETED (no longer in updated list)
   c. Add selections for items that are NEW (not in old set)
   d. Keep existing selections for items that still exist unchanged
3. Do the same for controls
4. Save using canonical keys (selectedSystemInstances, selectedSystemControls)
```

This ensures:
- Editing a water system attribute does NOT change any asset selections
- Adding a new item auto-selects it (and its controls)
- Deleting an item removes it from selections
- Existing manual deselections are preserved

**Secondary fix** (same file, line 1140-1141): Also update the analysis import path (lines 1138-1143) to use canonical keys:
- `selectedWaterSystemInstances` -> `selectedSystemInstances`
- `selectedWaterSystemControls` -> `selectedSystemControls`

## Files Changed

| File | Change |
|---|---|
| `src/pages/ProjectWizard.tsx` | Replace `onUpdateItems` callback (lines 1943-1965) with merge-based selection logic. Fix legacy key names at lines 1140-1141. |

No other files change. No DB changes. No new dependencies.

## Technical Details

The new `onUpdateItems` callback will look like:

```typescript
onUpdateItems={async (items, changeCount) => {
  // Capture old item IDs before updating state
  const oldItemIds = new Set(analysisItems.map(i => i.id));
  
  setAnalysisItems(items);
  
  // Save to database
  if (id && id !== "new") {
    try {
      await saveAnalysisItems(id, items);
      toast({ title: "Saved", description: `${changeCount || items.length} change(s) saved successfully` });
    } catch (error) {
      console.error("Error saving analysis items:", error);
    }
  }
  
  // Merge selections: preserve existing, auto-select NEW items only
  const newItemIds = new Set(items.map(i => i.id));
  
  // Helper to merge selections for a category
  const mergeSelections = (
    category: string,
    existingInstanceKey: string,
    existingControlKey: string
  ) => {
    const categoryItems = items.filter(i => i.category === category);
    const categoryItemIds = new Set(categoryItems.map(i => i.id));
    
    // Current saved selections - keep only items that still exist
    const currentInstances: string[] = projectData[existingInstanceKey] || [];
    const currentControls: string[] = projectData[existingControlKey] || [];
    
    const survivingInstances = currentInstances.filter(id => categoryItemIds.has(id));
    const survivingControls = currentControls.filter(cid => {
      const instanceId = cid.split("::")[0];
      return categoryItemIds.has(instanceId);
    });
    
    // Find truly new items (not in old set)
    const newItems = categoryItems.filter(i => !oldItemIds.has(i.id));
    const newInstanceIds = newItems.map(i => i.id);
    const newControlIds = newItems.flatMap(i =>
      (i.controls || []).map(c => `${i.id}::${c}`)
    );
    
    return {
      instances: [...survivingInstances, ...newInstanceIds],
      controls: [...survivingControls, ...newControlIds],
    };
  };
  
  const assets = mergeSelections("Asset", "selectedAssetInstances", "selectedAssetControls");
  const systems = mergeSelections("Water System", "selectedSystemInstances", "selectedSystemControls");
  const processes = mergeSelections("Process", "selectedProcessInstances", "selectedProcessControls");
  
  updateFields({
    selectedAssetInstances: assets.instances,
    selectedAssetControls: assets.controls,
    selectedSystemInstances: systems.instances,
    selectedSystemControls: systems.controls,
    selectedProcessInstances: processes.instances,
    selectedProcessControls: processes.controls,
  });
}}
```
