
# Fix: Duplicate Roof Items and Missing Default Controls

## Problem 1: Roof Added Twice
The existing item count query filters by `category` (e.g., "Asset") instead of by the specific AWP class name. This means it counts ALL assets, not just Electrical Rooms. More importantly, there's no deduplication check -- if items with the same class already exist in the project, the code blindly inserts duplicates.

**Fix**: Filter existing items by `name = awpClassName` (e.g., "Electrical Room") instead of by `category`. This ensures correct sequential numbering AND allows us to detect if items already exist.

## Problem 2: Default Controls Not Assigned
The `handleAddToProject` function inserts rows with no `controls` field. The source tables (`critical_assets`, `water_systems`, `processes`) have a `default_control_ids` column that maps class names to default control UUIDs, but the code never resolves these to control names.

**Fix**: Look up the default control IDs from the source table matching the AWP class name, resolve them to control names via the `mitigation_controls` table, and include them in the inserted rows.

## Technical Changes

### File: `src/components/analysis/AnalysisSection.tsx`

**1. Fix existing item count query (line 370-374)**

Change from filtering by `category` to filtering by `name`:
```typescript
// Before
.eq("category", category)

// After  
.eq("name", awpClassName)
```

This ensures sequential IDs are scoped to the specific class (e.g., ERM001-ERM006 for Electrical Rooms only).

**2. Add default controls lookup and assignment (inside handleAddToProject)**

Before building rows:
- Query the appropriate source table (`critical_assets`, `water_systems`, or `processes`) to get `default_control_ids` for the matching class name
- Query `mitigation_controls` to resolve those UUIDs to control names
- Include the resolved control names in each inserted row's `controls` array

```typescript
// Resolve default controls
let defaultControlNames: string[] = [];
const sourceTable = category === "Asset" ? "critical_assets" 
  : category === "Water System" ? "water_systems" : "processes";

const { data: sourceEntry } = await supabase
  .from(sourceTable)
  .select("default_control_ids")
  .eq("name", awpClassName)  // or fuzzy match
  .maybeSingle();

if (sourceEntry?.default_control_ids?.length) {
  const { data: controls } = await supabase
    .from("mitigation_controls")
    .select("name")
    .in("id", sourceEntry.default_control_ids);
  defaultControlNames = controls?.map(c => c.name) || [];
}

// Then in row construction:
return {
  ...existingFields,
  controls: defaultControlNames,
};
```

### No other files or database changes needed.
