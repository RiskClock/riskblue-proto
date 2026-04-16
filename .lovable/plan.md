

## Plan: Fix summarize-analysis deduplication prompt

### Root cause
The `summarize-analysis` edge function's system prompt has dedup rules that don't match the actual data:
- References "Generated Room Code (e.g., ER001)" but actual data uses "Room Identifier on Plan (e.g., SWC-B04)"
- Rule says "same Drawing Label AND Floor" = likely same — too strict. Rooms like `SWC-B04` appearing on multiple floors' drawings are the same physical room tagged on different sheets
- The AI is treating every row from every file as unique because the dedup criteria don't trigger

Looking at the screenshot: `SWC-901 / ELECTRICAL ROOM / Roof` and `SWC-901 / ELECTRICAL ROOM / ROOF` are clearly duplicates (same ID, same floor with case difference). `SWC-703 / IT ROOM / SEVENTH FLOOR` appears twice. These should all be deduped.

### Fix: Rewrite the dedup prompt in `summarize-analysis`

**File**: `supabase/functions/summarize-analysis/index.ts`

Update the system prompt to:
1. Reference the correct column name ("Room Identifier on Plan" not "Generated Room Code")
2. Make the primary dedup key the Room Identifier — if two entries share the same identifier (case-insensitive), they are the same instance regardless of which file/sheet they came from
3. When merging duplicates, keep the entry with the most data (largest area, most notes)
4. Only treat entries as distinct if they have different Room Identifiers AND different floors

### Files to change
1. `supabase/functions/summarize-analysis/index.ts` — Update system prompt dedup rules to match actual data column names and strengthen dedup logic

