

# Fix AWP Class Filtering: Match by Control ID Across All Categories

## Problem
The current `visibleAwpClasses` computation in `WMSVProjectDetail.tsx` filters AWP classes by matching controls **within the same category**. For example, if "Presence of Water Monitoring" is enabled under `critical_assets`, it only unlocks critical asset AWP classes — not water system or process AWP classes that also use that control.

The correct behavior: collect **all enabled control IDs** (ignoring category), then show **any AWP class** (from any source table) that has at least one of those control IDs in its `default_control_ids`.

## Change

**File: `src/components/WMSVProjectDetail.tsx`** (lines 98-113)

Replace the category-grouped filtering logic with a simpler approach:

1. Collect all unique `control_id` values from `controlSelections` into a single flat `Set<string>`
2. Filter `awpSourceData` to include any AWP class where at least one of its `controlIds` is in that set

```typescript
const visibleAwpClasses = useMemo(() => {
  if (!controlSelections || !awpSourceData) return undefined;
  // Flat set of all enabled control IDs, regardless of category
  const enabledControlIds = new Set(controlSelections.map(sel => sel.control_id));
  return awpSourceData
    .filter((awp) => awp.controlIds.some((cid) => enabledControlIds.has(cid)))
    .map((awp) => awp.name);
}, [controlSelections, awpSourceData]);
```

This is a ~10 line change in one file. No database or other file changes needed.

