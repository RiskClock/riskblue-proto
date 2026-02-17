

# Fix: Deleted Instances Still Show Up After Save

## Root Cause

In `saveAnalysisItems` (src/pages/ProjectWizard.tsx, line 1181), there is an early return when `items.length === 0`:

```typescript
if (items.length === 0) {
  console.warn("No analysis items to save");
  return;  // Skips the DELETE + INSERT entirely!
}
```

When you delete all 12 items and confirm, the modal calls `onUpdateItems([])` with an empty array. `saveAnalysisItems` hits this early return, so it never executes the `DELETE FROM project_analysis_items WHERE project_id = ...` query. The UI state clears, but the database still has all 12 rows. On the next page load, they reappear.

## Fix

**File: `src/pages/ProjectWizard.tsx`** (lines 1181-1184)

Remove the early return for empty items. Instead, when `items.length === 0`, still execute the delete query but skip the insert:

```typescript
// Before (broken):
if (items.length === 0) {
  console.warn("No analysis items to save");
  return;
}

// After (fixed):
// Delete existing items first (always)
const { error: deleteError } = await supabase
  .from('project_analysis_items')
  .delete()
  .eq('project_id', projectId);

if (deleteError) {
  console.error("Error deleting existing analysis items:", deleteError);
}

// If no new items to insert, we're done
if (items.length === 0) {
  console.log("All items deleted, nothing to insert");
  return;
}

// ...proceed with insert as before
```

This ensures the database DELETE always runs, even when the result is an empty item list.

## Technical Details

- Only one file changes: `src/pages/ProjectWizard.tsx`
- The fix moves the DELETE query before the empty-items guard
- The INSERT logic remains unchanged
- No schema or RLS changes needed
