# Spatial Architect: duplicate badges and the 544 unmapped bboxes

## What the data actually says (verified)

For "QuadReal – Tri Cities" (117 sheets):

- Total bboxes detected: **982** — 710 schematic level rows, 81 level floor plans, 191 typical detail blocks.
- Bboxes eligible for level mapping (schematic rows + level floor plans): **791**.
- Currently attached to a level: **247**. Unmapped: **544**. So yes, the 544 is real, not a display bug.

### 1. The "LEVEL P5 · p106 × 4" duplicates are not duplicates

Page 106 genuinely contains four separate schematic level rows labelled "LEVEL P5" (`fp_p106_01`, `fp_p106_08`, `fp_p106_15`, `fp_p106_22`) — one per riser/schematic column on that sheet. Same for page 107. They are distinct bboxes at different coordinates, so the modal correctly attaches all four to level P5; the chips just look identical because the chip only shows label + page.

### 2. The 544 unmapped bboxes come from one canonicalization bug

The project's canonical level names are `L1…L43`, `P1…P5`. Bbox labels from the survey are `LEVEL 41`, `LEVEL 2`, `LEVEL P5`, etc.

`normalizeLevelToken` strips the word "level", so:

```text
"LEVEL P5" -> "p5"   vs canonical "P5" -> "p5"    MATCH
"LEVEL 41" -> "41"   vs canonical "L41" -> "l41"  NO MATCH
```

Every parking level matched; every numbered level failed. That is exactly the 544 that fell through to "Unmapped".

## The fix

1. **`src/pages/WorkbenchProjectDetail.tsx` — `normalizeLevelToken`**: after word-to-digit conversion, strip a leading `L`/`LVL` before a number (`l41` -> `41`). This makes `LEVEL 41` resolve to `L41` everywhere canonicalization is used (bbox catalog, badges, threat-report attribution). No data migration is needed — the mapping is derived, so the unmapped count should drop from 544 to only genuinely non-level bboxes (site plans, future-phase blocks, etc.).
2. **`src/components/workbench/SpatialArchitectModal.tsx` — chip disambiguation**: when several attached bboxes on the same page share a label, render one chip per bbox with a distinguishing suffix (e.g. `LEVEL P5 · p106 (1 of 4)`), so identical-looking chips are recognisable and individually removable.
3. **Unmapped list grouping**: group the unmapped audit list by file + label with counts instead of listing 544 rows flat, so real gaps are visible at a glance.

## Verification

After the change, re-check the catalog counts: attached should rise from 247 to roughly 780+, and the unmapped list should contain only non-level labels.

## Open question

For step 2, would you rather keep one chip per bbox (accurate, four chips for page 106) or collapse repeats into a single chip like `LEVEL P5 · p106 ×4` that attaches/detaches all four at once?
