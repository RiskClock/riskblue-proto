## Issues found in latest run (Test3, request `32102393…`)

### Issue 1: Low-triage cell got analyzed
**`RB-A05-LVL4-V9.pdf` × `Elevator Pit`** had a max triage score of **20**, yet was analyzed (returned 0 results = the empty cell in the screenshots).

**Root cause** — `supabase/functions/run-analysis-pipeline/index.ts`, line 1481:
```ts
if (!eligible && t.sheet_role === "analysis_sheet") eligible = true;
```
This admits any file/class pair where the triage model labelled at least one sheet as `analysis_sheet`, **regardless of its score**. The Elevator-Pit triage on this file produced an analysis_sheet label with score 20, so the pair slipped through.

`sheet_role` is the triage model's self-classification of a page as `analysis_sheet` (worth analyzing in Pass-2) vs `context_sheet` (only useful as side-context). It's separate from the numeric `score` (model's confidence the class is present, 0–100). The intended canonical rule per memory `mem://logic/drawing-analysis-triage-scoring` is the **50% score threshold**, not the role label.

### Issue 2: `Combined Electrical.pdf` × `Electrical Room` failed
Pipeline job failed after 3 attempts with `error_message = "The signal has been aborted"`. This is the analyze-drawings call timing out / being aborted (Combined Electrical is the largest file, ~25MB). The other 8 jobs on the same run completed fine on attempt 1.

---

## Fix

### 1. Strict score-only eligibility (Phase 3)
File: `supabase/functions/run-analysis-pipeline/index.ts`

In the sheet-mode branch (around line 1471–1482), remove the `sheet_role === "analysis_sheet"` fallback. New rule:

```ts
let eligible = override === "include";
if (
  !eligible &&
  t.status === "complete" &&
  t.score !== null &&
  t.score >= 50
) {
  eligible = true;
}
// (no sheet_role fallback)
if (!eligible) continue;
```

Also update the parallel debug-eligibility recomputation (lines 1584–1588) to match — drop the `|| t.sheet_role === "analysis_sheet"` clause so the `DROPPED` log accurately reflects the new rule.

The non-sheet branch (lines 1517–1539) already uses score-only and needs no change.

This restores the canonical "≥50% score" rule from `mem://logic/drawing-analysis-triage-scoring`. The historical concern that motivated the role fallback ("score=100 pages mislabeled context_sheet") is no longer a risk — those pages still pass the score check.

### 2. Investigate Combined Electrical / ERM abort
Pull `analyze-drawings` logs filtered to that file/class for the run (timestamp ~2026-05-07 15:42–15:46 UTC) to identify whether the abort comes from:
- the analyze-drawings function exceeding the Edge Function wall time,
- the OpenAI/Gemini call itself, or
- the worker-side AbortController timeout in `process-analysis-jobs`.

Then either raise the relevant timeout for large PDFs or fall back to a raster/page-chunked retry. No code change yet — first read logs and report findings, since the right fix depends on which boundary aborted.

### 3. Redeploy
After the edit in step 1, redeploy `run-analysis-pipeline` so the next run uses the strict rule.

---

## Out of scope (per your reply)
- Other green cells showing 0 results (e.g. RB-A01/ELVP) — not addressed in this plan.
- Removing the temporary `[pipeline][DEBUG]` block — leaving it in place; it's still useful and now reflects the strict rule.
