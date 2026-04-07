

# Fix Circle Detection for Non-Room-Tag Responses (e.g. DCW)

## Problem

The `parseRoomTagsFromResult` function only recognizes column headers containing keywords like "room code", "generated room", "room identifier", "code", or "id". The DCW response uses "Component Type" as its first column with values like "Pre-Booster", "Post-Booster", "Zone Entry" — none of which match these patterns, so zero tags are returned and no circles are drawn.

## Solution

Expand the header detection and ID column detection to recognize additional column name patterns commonly used in AI responses.

### File: `src/components/analysis/AnalysisSection.tsx`

**Line 141 — HEADER_KW array**: Add `"component"`, `"type"`, `"identifier"`, `"tag"` to the keyword list so the header row is detected.

**Line 152 — idCol finder**: Add `h.includes("component type")` and `h.includes("component")` and `h.includes("identifier")` as additional matchers. If no specific match is found, fall back to using the first non-empty column (index 1, since index 0 is the empty string before the first `|`).

**Fallback strategy**: If `idCol` is still -1 after all keyword checks, use the first data column (index 1) as the tag source. This ensures that even with unexpected column headers, the first column values are used for text-layer search.

## Scope

| File | Change |
|---|---|
| `src/components/analysis/AnalysisSection.tsx` | Expand `HEADER_KW` and `idCol` matching in `parseRoomTagsFromResult` (~lines 141-156) |

