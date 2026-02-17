

# Fix "Add to Project" Failure

## Root Cause

Three bugs in the `handleAddToProject` function in `AnalysisSection.tsx`:

1. **Category CHECK constraint violation**: The code sets `category: awpClassName` (e.g., `"Electrical Room"`), but the `project_analysis_items` table has a CHECK constraint requiring one of `'Asset'`, `'Water System'`, or `'Process'`. This causes the insert to fail with a constraint error.

2. **Wrong `awp_class_id` lookup**: The code looks up `awp_class_id` from the source tables (`critical_assets`, `water_systems`, `processes`), but the foreign key references the `awp_classes` table which has entirely different UUIDs. The lookup needs to query `awp_classes` instead.

3. **Error message not displayed**: The Supabase client returns a `PostgrestError` object (not an `Error` instance), so `e instanceof Error` is `false`, and the toast shows "Unknown error" instead of the actual constraint violation message.

## Fix Details

### File: `src/components/analysis/AnalysisSection.tsx`

**1. Replace the `sourceEntries` query** (lines 233-243)

Instead of querying `critical_assets`/`water_systems`/`processes` for `id` and `id_prefix`, query the `awp_classes` table which is what `project_analysis_items.awp_class_id` actually references:

```typescript
const { data: awpClasses } = useQuery({
  queryKey: ["awp-classes-all"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("awp_classes")
      .select("id, name, category, id_prefix");
    if (error) throw error;
    return data;
  },
});
```

**2. Fix `handleAddToProject`** (lines 358-412)

- Look up the AWP class from `awp_classes` by fuzzy-matching the name (e.g., "Electrical Room" matches "Electrical Rooms")
- Use the matched entry's `category` (`'Asset'`, `'Water System'`, or `'Process'`) for the `category` column
- Use the matched entry's `id` for `awp_class_id`
- Use the matched entry's `id_prefix` for generating `item_id`

**3. Fix error handling** (line 406)

Change from:
```typescript
description: e instanceof Error ? e.message : "Unknown error",
```
To:
```typescript
description: (e as any)?.message || "Unknown error",
```

This ensures PostgrestError messages (like constraint violations) are displayed instead of "Unknown error".

### No other files need changes. No database changes required.
