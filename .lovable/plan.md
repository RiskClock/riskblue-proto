
# Fix DCW Circle Rendering by Searching the Right Column

## What’s actually going wrong

The current overlay parser is still using the wrong search target for DCW-style results.

For ERM, the first column contains searchable tags/room codes, so circles appear.

For DCW, the first column is `Component Type` with values like:
- `Pre-Booster`
- `Post-Booster`
- `Zone Entry`

Those are category labels, not the text most likely printed on the drawing. The drawing-searchable strings are more likely in columns like:
- `Drawing Label`
- `Code`
- `Label`
- possibly notes containing things like `Ø25 CW UP`

So even though the table is being parsed now, `findBBoxInTextLayer()` is still trying to locate text like `Zone Entry`, which likely does not exist as exact PDF text, so no circles are drawn.

## Plan

### 1. Change result parsing to produce search candidates, not just one tag
Update the raw-result overlay parser in `src/components/analysis/AnalysisSection.tsx` so each table row can yield multiple candidate strings in priority order.

Priority should be:
1. `Drawing Label`
2. `Generated Room Code` / `Room Code`
3. `Code` / `Identifier` / `Tag`
4. `Component Type` only as a last fallback

This lets DCW rows search for `Ø25 CW UP` instead of `Zone Entry`.

### 2. Add a dedicated parser for overlay search rows
Keep the existing instance-count parsing behavior intact, but create or refactor a parser specifically for drawing overlays that returns:
- `candidates: string[]`
- `pageNum: number`

That avoids coupling overlay logic to the old “room tag” assumption.

### 3. Try multiple candidates per result row
In `RawResultModal`, when locating each instance:
- iterate through the row’s candidate strings in order
- stop on the first successful PDF text match
- only skip the row if all candidates fail

This will make DCW resilient while preserving ERM behavior.

### 4. Improve normalization for drawing labels
Extend text normalization in `findBBoxInTextLayer()` to better handle mechanical/plumbing labels:
- diameter symbol variants: `Ø`, `∅`
- spacing differences
- dash/hyphen variants
- uppercase/lowercase consistency

This is important because labels like `Ø25 CW UP` may not match cleanly with the current normalizer.

### 5. Keep page handling but don’t rely on it too much
Continue using `Sheet / Page Reference` when present, but preserve the current fallback of checking other pages if the hinted page fails.

### 6. Update InstanceDetailModal too
`InstanceDetailModal` currently still assumes a single primary tag based on `instance.id`. For DCW-like data, that may also be wrong. Reuse the same candidate-selection logic there so the single-instance viewer and raw-result viewer behave consistently.

## Files to change

| File | Change |
|---|---|
| `src/components/analysis/AnalysisSection.tsx` | Replace the room-tag-only overlay parsing with a candidate-based row parser; try `Drawing Label`/code fields before `Component Type`; reuse the same logic in both `RawResultModal` and `InstanceDetailModal`; extend normalization for plumbing/mechanical labels |

## Expected result

For DCW results, the viewer should draw circles using searchable drawing labels like `Ø25 CW UP` rather than category names like `Zone Entry`, so the 5 detected instances can actually be highlighted on the drawing.

## Technical notes

- `parseResultText()` is used for counts and summary data; it should not be broken.
- The overlay issue is specifically in `parseRoomTagsFromResult()` plus how `RawResultModal` and `InstanceDetailModal` choose the search string.
- The safest implementation is to introduce a new overlay-focused parser instead of continuing to overload the room-tag parser.
