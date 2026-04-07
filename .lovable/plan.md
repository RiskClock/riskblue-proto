

# Fix Circles for Long-Description Drawing Labels (Pre-Booster, Post-Booster)

## Problem

Pre-Booster and Post-Booster rows have very long "Drawing Label" values like `100mm DIA POTABLE WATER INFRASTRUCTURE LINE; BACKFLOW PREVENTER`. These never appear as a single text item (or even 4 consecutive items) in the PDF text layer, so `findBBoxInTextLayer` returns null and no circle is drawn.

Zone Entry rows work because their labels (`Ø25 CW UP`) are short enough to match a single text item.

## Solution

Add a **substring matching pass** to `findBBoxInTextLayer` that activates when exact matching fails. For long candidates, search for PDF text items whose normalized content appears as a substring within the normalized candidate (minimum 4 chars to avoid false positives). Use the longest such match as the anchor point.

### File: `src/components/analysis/AnalysisSection.tsx`

**After Pass 2 (line ~348), before the `continue` on line 350**, add a Pass 2.5:

- If `matchedItem` is still null and `normTag.length > 15`, iterate all text items
- For each item with `normalizeText(item.str).length >= 4`, check if `normTag.includes(normalizeText(item.str))`
- Track the longest matching item as the best candidate
- Use that item as `matchedItem`

This means for `100mm dia potable water infrastructure line; backflow preventer`, if the PDF has a text item `BACKFLOW PREVENTER` or `100mm`, it will anchor the circle there.

## Files Changed

| File | Change |
|---|---|
| `src/components/analysis/AnalysisSection.tsx` | Add substring matching pass in `findBBoxInTextLayer` (~line 348) for long candidates that fail exact match |

