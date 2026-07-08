## Problem

The Scout agent ignores the new `typical_detail_block` and `schematic_level_row` vocabulary because the Gemini `responseSchema` strictly enforces an enum that only lists the two original values. Gemini's structured-output enforcement drops/coerces any value not in the enum, so the prompt guidance is silently overridden. The frontend TypeScript union has the same gap and would strip new values even if they got through.

## Fix

### 1. `supabase/functions/survey-pages/schema.ts` (line 81)
Expand the `type` enum on the floor-plan item schema from:
```
enum: ["level_floor_plan", "unit_floor_plan"]
```
to:
```
enum: ["level_floor_plan", "unit_floor_plan", "schematic_level_row", "typical_detail_block"]
```
Update the accompanying `description` to briefly note the four categories so the model has schema-level context matching the prompt.

### 2. `src/lib/surveyFloorPlans.ts`
- Extend the `FloorPlanType` union (lines 5–6) to include `"schematic_level_row"` and `"typical_detail_block"`.
- Review the two call sites that reference the union:
  - Line 163 (`plan.type !== "unit_floor_plan"` guard) — confirm intended behavior for the new types; leave logic unchanged unless it clearly needs to treat schematic rows / detail blocks the same as units. Flag but don't repurpose.
  - Line 232 default fallback — keep `"unit_floor_plan"` as the fallback when `entry.type` is missing.
- Update the comment on line 196 to list all four types.

### 3. No other changes
No DB migration, no prompt changes (prompt already teaches the vocabulary), no UI changes. Downstream consumers that switch on `type` will continue to treat unknown-to-them values as pass-through strings.

## Verification

After deploy, re-run Scout on the same file and confirm the persisted `surveyed_pages[].floor_plans[].type` includes `schematic_level_row` / `typical_detail_block` where appropriate, and that Gemini no longer coerces them to `unit_floor_plan`.
