

# Fix: All 6 Instances Should Appear in Project

## Problem

All 6 instances were actually inserted into the database successfully (ERM001-ERM006). The issue is that the `name` field stores the raw AI label (e.g., "ELECTRICAL", "SUBSTATION ROOM", "IT ROOM") instead of the normalized AWP class name ("Electrical Room").

The Project Wizard groups items by their `name` field matching known AWP class names. Since "ELECTRICAL" and "IT ROOM" don't match the pattern for "Electrical Room" in `mapToAssetName`, they are treated as unrecognized items and not displayed under any AWP class.

Only "ERM001: Electrical Room" shows because its `name` happens to exactly match.

## Fix

**File: `src/components/analysis/AnalysisSection.tsx`** -- in the `handleAddToProject` function

Change how rows are built so that:
- `name` is set to the **AWP class name** (e.g., "Electrical Room") instead of the raw AI label
- The raw AI label (e.g., "ELECTRICAL", "SUBSTATION ROOM") goes into `area_name` to preserve the specific identifier

```text
Before:
  name: inst.name         --> "ELECTRICAL", "SUBSTATION ROOM", "IT ROOM"
  area_name: (not set)

After:
  name: awpClassName      --> "Electrical Room" (for all instances)
  area_name: inst.name    --> "ELECTRICAL", "SUBSTATION ROOM", "IT ROOM"
```

This single change ensures all instances are recognized by the wizard's grouping logic while preserving the specific room labels.

Also need to clean up the 5 orphaned items already in the database. The user should delete the existing items and re-add from the analysis page.

## Technical Details

### Change in `handleAddToProject` (around line 382-389)

Update the row construction from:
```typescript
return {
  project_id: projectId,
  item_id: itemId,
  name: inst.name,
  category: category,
  ...
};
```
To:
```typescript
return {
  project_id: projectId,
  item_id: itemId,
  name: awpClassName,           // Use AWP class name for grouping
  area_name: inst.name,         // Preserve raw label as area name
  category: category,
  ...
};
```

### No other files need changes
The wizard already reads `area_name` and displays it alongside the item.
