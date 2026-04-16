

## Plan: Fix red circle positioning — prioritize unique IDs in text search

### Problem
The text-layer bbox search tries `areaName` (e.g. "W/C") before the unique display ID (e.g. "SWC-102"). Since multiple instances share the same `areaName`, `findBBoxInTextLayer` returns the first match for all of them, placing all red circles at the same location.

### Fix
Reorder the candidate list in two places so unique identifiers are tried first:

**1. `src/components/wizard/LocationDetailsModal.tsx` (line ~150-154)**

Change candidate order from `[areaName, drawingCode, id, name]` to `[id, drawingCode, areaName, name]`. The unique ID like "SWC-102" will match its exact text on the drawing before the generic "W/C" gets a chance.

**2. `src/lib/analysisDocxExporter.ts`**

Apply the same candidate ordering fix wherever bbox search candidates are built for the DOCX export (if it uses the same pattern).

### Why this works
- "SWC-102" and "SWC-103" appear as distinct text items on the drawing at their actual locations
- By searching for the unique tag first, each instance gets its own correct bounding box
- The generic name ("W/C") remains as a fallback if the unique ID isn't found in the text layer

