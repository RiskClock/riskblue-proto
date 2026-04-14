

# Updated Plan

The plan's Issue 1 fix incorrectly hides checkboxes for WMSV users. WMSV users **should** be able to select/deselect AWP classes via checkboxes — the only thing disabled for WMSV is the hyperlink on the abbreviation (already done correctly).

## Revised Issue 1 Fix

**Pipeline change (unchanged):** When `visibleAwpClasses` is provided, skip `disabledColumns` filter — `visibleAwpClasses` is the authoritative filter.

**UI change (revised):** Keep per-column checkboxes visible for WMSV users. WMSV users can toggle classes on/off just like internal users. The only WMSV-specific UI difference remains the non-clickable abbreviation text (already implemented). When WMSV users deselect a class, it gets added to `disabledColumns` and sent to the pipeline normally — but the pipeline will intersect `disabledColumns` with `visibleAwpClasses` rather than ignoring `disabledColumns` entirely.

**Updated pipeline logic:** Instead of "skip `disabledColumns` when `visibleAwpClasses` is provided," the pipeline should: (1) filter prompts to only those in `visibleAwpClasses`, then (2) apply `disabledColumns` on top of that filtered set. This way `visibleAwpClasses` limits the universe and `disabledColumns` lets the user further narrow it.

## Updated Summary of File Changes

| File | Change |
|---|---|
| `supabase/functions/run-analysis-pipeline/index.ts` | 1) Filter by `visibleAwpClasses` first, then apply `disabledColumns` on top. 2) Add retry-with-backoff for rate-limited calls. 3) Track failures and avoid marking "complete" when all items failed. |
| `src/components/analysis/AnalysisSection.tsx` | 1) **Keep** per-column checkboxes for WMSV users (revert the hide). 2) Send `disabledColumns` normally in WMSV mode. 3) Show error message from DB when analysis failed. |

Issues 2 and 3 remain unchanged from the previous plan.

