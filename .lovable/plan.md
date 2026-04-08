

# Fix: Use Correct ID Prefix When Adding Analysis Instances to Project

## Problem

`handleAddToProject` uses a fuzzy `awpClasses?.find()` lookup (lines 3215-3219) to resolve the `id_prefix`. If the AWP class name from the summarization doesn't exactly match the `awp_classes` table, the match fails and falls back to `"AWP"` — producing IDs like `AWP001` instead of `DCW001`. Since controls are assigned based on the source table match (which also uses exact name matching), they may also fail.

## Root Cause

The `awpClassName` passed to `handleAddToProject` comes from the column header in the analysis grid (the prompt's `awp_class_name`), but the `awp_classes` table may store a slightly different name. The fuzzy `startsWith` matching is unreliable.

## Fix

**File: `src/components/analysis/AnalysisSection.tsx`**

In `handleAddToProject`, replace the fuzzy `awpClasses?.find()` lookup with the already-available `sourcePrefixMap` and `awpOrderData`:

1. **ID prefix** — use `sourcePrefixMap[awpClassName]` first, then fall back to `idPrefixMap[awpClassName]`, then to the 3-letter fallback. Remove the fuzzy `awpClasses?.find()` block.

2. **Category** — derive from `awpOrderData` entry's `globalOrder` (0-999 = Asset, 1000-1999 = Water System, 2000+ = Process), or look up from prompts.

3. **Default controls** — the source table query (`eq("name", awpClassName)`) should work since `awpClassName` comes from the same source tables. But add a fallback: also try matching from `awp_class_prompts` which links to the source table entry.

### Concrete change

Replace lines 3215-3224:
```typescript
const awpClass = awpClasses?.find(
  (c) =>
    c.name.toLowerCase() === awpClassName.toLowerCase() ||
    c.name.toLowerCase().startsWith(awpClassName.toLowerCase()) ||
    awpClassName.toLowerCase().startsWith(c.name.toLowerCase())
);

const idPrefix = awpClass?.id_prefix || "AWP";
const awpClassId = awpClass?.id || null;
const category = awpClass?.category || "Asset";
```

With:
```typescript
// Use source-of-truth prefix maps (built from critical_assets/water_systems/processes)
const idPrefix = sourcePrefixMap[awpClassName] || idPrefixMap[awpClassName] || 
  awpClassName.replace(/[^a-zA-Z]/g, "").substring(0, 3).toUpperCase();

// Derive category from awpOrderData globalOrder
const orderEntry = awpOrderData?.find(x => x.name === awpClassName);
const category = orderEntry 
  ? (orderEntry.globalOrder < 1000 ? "Asset" : orderEntry.globalOrder < 2000 ? "Water System" : "Process")
  : "Asset";

// Still try to get awpClassId for the DB record
const awpClass = awpClasses?.find(c => c.name === awpClassName);
const awpClassId = awpClass?.id || null;
```

This ensures "Domestic Cold Water" → prefix `DCW` (from the `water_systems` table), and the correct category is derived, which in turn ensures the right source table is queried for default controls.

## Files to update

| File | Change |
|---|---|
| `src/components/analysis/AnalysisSection.tsx` | Replace fuzzy awpClasses lookup in `handleAddToProject` with `sourcePrefixMap`/`idPrefixMap` |

