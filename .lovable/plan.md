

# Fix Text-Layer Search Fallback in LocationDetailsModal

## Problem

Line 150 in `LocationDetailsModal.tsx`:
```typescript
const searchId = loc.id || loc.areaName || loc.name;
```

`loc.id` is always truthy (e.g., "ERM003") — a generated ID that doesn't exist in the PDF. The search never reaches `loc.areaName` ("SUBSTATION ROOM") or `loc.name` ("Electrical Room"), so `findBBoxInTextLayer` finds nothing.

## Fix

**File: `src/components/wizard/LocationDetailsModal.tsx`** (lines ~148-158)

Replace the single `searchId` with a multi-candidate approach matching what `AnalysisSection.tsx` already does:

1. Build a candidates array: `[loc.areaName, loc.drawingCode, loc.id, loc.name]` (filtered for truthy values)
2. Loop through candidates, calling `findBBoxInTextLayer` for each until one succeeds
3. This ensures "SUBSTATION ROOM" and "SWC-B03" are tried before the generated "ERM003"

```typescript
// Build search candidates in priority order (most specific first)
const candidates: string[] = [];
if (loc.areaName) candidates.push(loc.areaName);
if (loc.drawingCode) candidates.push(loc.drawingCode);
if (loc.id) candidates.push(loc.id);
if (loc.name) candidates.push(loc.name);

for (const candidate of candidates) {
  textBBox = await findBBoxInTextLayer(pdf, candidate);
  if (textBBox) break;
}
```

## Files to update

| File | Change |
|---|---|
| `src/components/wizard/LocationDetailsModal.tsx` | Replace single `searchId` lookup with multi-candidate loop |

