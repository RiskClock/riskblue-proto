

# Store Display ID for Text-Layer Search in Project Items

## Problem

When analysis instances are added to the project via `handleAddToProject`, the `inst.id` field (e.g., "100mm DIA POTABLE WATER INFRASTRUCTURE LINE; BACKFLOW PREVENTER") — which is the label that actually exists in the PDF text layer — is not persisted. The `drawing_code` column in `project_analysis_items` exists but is never populated.

On the project page, `LocationDetailsModal` tries to circle the location using candidates: `areaName` ("Pre-Booster"), `drawingCode` (null), `id` ("DCW001"), `name` ("Domestic Cold Water"). None of these match PDF text, so the circle never appears.

## Fix

**File: `src/components/analysis/AnalysisSection.tsx`** — in `handleAddToProject` (around line 3139-3153)

Store `inst.id` (the display ID from summarization) into the `drawing_code` column of the insert row:

```typescript
return {
  // ...existing fields...
  drawing_code: inst.id,  // <-- ADD THIS LINE
};
```

This populates the `drawing_code` column that already exists in the DB schema. The `LocationDetailsModal` already includes `loc.drawingCode` (mapped from `drawing_code`) in its text-layer search candidates at priority position 2, so it will automatically be tried during fallback search.

## Files to update

| File | Change |
|---|---|
| `src/components/analysis/AnalysisSection.tsx` | Add `drawing_code: inst.id` to the insert row in `handleAddToProject` |

