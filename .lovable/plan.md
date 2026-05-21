## Goal

Make the three Analysis Queue buttons strictly bounded by phase: each button **clears its own phase and every later phase**, **auto-backfills missing prior phases**, runs **up to its own phase only**, and then leaves the request idle in `started` state. No phase past the clicked button ever runs.

## Per-button contract

| Button | Clears (current run) | Runs (in order) | End state |
|---|---|---|---|
| **Extract Context** | extract artifacts + triage + analyze + overrides + summary + tokens | split (if needed) → extract | `status='started'`, `pipeline_phase=null` |
| **Triage** | triage + analyze + overrides + summary + analyze tokens | extract (only sheets missing `extracted_text`/`extract_status='done'`) → triage | `status='started'`, `pipeline_phase=null` |
| **Analyze** | analyze + summary + analyze tokens | extract (missing sheets only) → triage (missing `(sheet,class)` pairs only) → analyze | `status='started'`, `pipeline_phase=null` |

Never runs Summarize from any button. Summarize remains reachable only via the existing internal `phaseOverride='summarize'` worker re-invocation (left untouched for now).

## Backend changes — `supabase/functions/run-analysis-pipeline/index.ts`

### 1. Phase ordering + bounded runPhase

Replace the current `runPhase`:
```ts
const PHASE_ORDER = ["split", "extract", "triage", "analyze", "summarize"];
const startIdx = phaseOverride ? Math.max(0, PHASE_ORDER.indexOf(phaseOverride)) : 0;
// stopIdx defines the LAST phase that should run for this invocation
const stopIdx = phaseOverride
  ? PHASE_ORDER.indexOf(phaseOverride)            // extract|triage|analyze stop at themselves
  : PHASE_ORDER.indexOf("summarize");             // full run (no override) goes to the end
const runPhase = (phase: string) => {
  const i = PHASE_ORDER.indexOf(phase);
  // "split" is treated as a prerequisite for "extract" — include it whenever extract or later runs
  if (phase === "split") return stopIdx >= PHASE_ORDER.indexOf("extract");
  return i >= startIdx && i <= stopIdx;
};
```

The pre-existing `summarize`-only internal branch must still be preserved (early return after phase 4 setup). Audit and keep that path intact.

### 2. Backfill: extract only missing units

In Phase 1, when `phaseOverride === "triage" | "analyze"`:
- Query sheets/files and filter the unit list to those where `extract_status <> 'done'` OR `extracted_text IS NULL/empty`.
- If the filtered list is empty, skip enqueueing extract jobs and fall straight through to Phase 2.
- Already-extracted sheets keep their `extracted_text` and `openai_file_id`.

### 3. Backfill: triage only missing pairs

In Phase 2 (and the Phase 3 dispatcher), when `phaseOverride === "analyze"`:
- For each enabled `(sheet_id, awp_class_name)` pair in the active run, check `analysis_triage_results` for an existing row stamped with the current `analysis_run_id`.
- Only enqueue triage jobs for missing pairs. Existing triage rows are reused for analyze dispatch.

### 4. Active run id preservation

Today: `phaseOverride === "summarize" | "analyze"` preserves the existing `analysis_run_id`; everything else mints a new one. Change to:
- `analyze` → preserve (unchanged)
- `triage` → **preserve** (new) — keeps extract artifacts valid under the same run id
- `extract` → mint new (matches "full clear")
- `summarize` → preserve (unchanged)

Cleanup blocks already match this scope (extract = full, triage = triage+analyze+overrides, analyze = analyze only) — no change needed there.

### 5. Stop after clicked phase

Today the pipeline cascades: extract finishes → triage runs → triage-finalize worker re-invokes with `phaseOverride='analyze'` → analyze-finalize re-invokes with `phaseOverride='summarize'`.

Add a guard so re-invocations only happen when the original `phaseOverride` permits the next phase:
- After triage finalize (worker code path), only re-invoke pipeline with `phaseOverride='analyze'` when the **active** run's `phaseOverride` was `analyze` or unset. If it was `triage`, do not re-invoke; instead write `status='started'`, `pipeline_phase=null`, `pipeline_progress_done=0`, `pipeline_progress_total=0`.
- After analyze finalize, only re-invoke with `phaseOverride='summarize'` when the active run's `phaseOverride` was unset (full run). If it was `analyze`, write `status='started'` idle state.
- After extract finishes, if `phaseOverride==='extract'`, do not proceed to Phase 2; write idle state and return.

Implementation: persist the original `phaseOverride` on `analysis_requests` (e.g. add a column `pipeline_phase_override text`, or stash on `summary_data._phase_override`) at the start of the run, so worker re-invocations and finalize handlers can read it back. Migration to add the column is preferred for clarity. Existing rows default to NULL (= full run).

### 6. Idle-state writer helper

Centralize the "stop cleanly after my phase" path in one helper that writes:
```ts
{ status: 'started', pipeline_phase: null, pipeline_progress_done: 0, pipeline_progress_total: 0, pipeline_stop_requested: false, error_message: null }
```
Call it at the end of Extract-only, Triage-only, and Analyze-only runs. This matches today's `handleStopped()` shape so the UI label engine (`useAnalysisRequestState`) treats it as terminal-idle, not running.

### 7. UI state derivation

Confirm `src/lib/analysisUiState.ts` + `useAnalysisRequestState.ts` already render `status='started' && pipeline_phase=null` as an idle/ready state (not "syncing"). If `analysis_run_id` is non-null and no active jobs/triage rows exist, it should resolve to a non-running label. Adjust only if a regression appears during verification.

## Frontend changes — `src/components/analysis/AnalysisSection.tsx`

Optimistic clearing in `startPipeline` (lines 1958–1975) already matches the contract. Remove or soften the "Run Extract Context first" toasts at lines 2458, 3097, 3174 because the backend now backfills. Keep the button labels themselves unchanged.

No change to credit consumption — `handleWmsvStartAnalysis` is the only credit-gated entry and still runs a full pipeline (no `phaseOverride`).

## Database migration

Add a nullable column to persist the per-run override:
```sql
ALTER TABLE public.analysis_requests
  ADD COLUMN IF NOT EXISTS pipeline_phase_override text;
```
Set it at run claim time alongside `analysis_run_id`; clear it (`NULL`) when a full run starts and when an idle state is written.

## Verification

1. Deploy `run-analysis-pipeline` and any worker that re-invokes it (`process-analysis-jobs`, `triage-drawings`, `analyze-drawings` — wherever the finalize → re-invoke happens).
2. Test matrix on a small request:
   - Fresh request → **Extract** → only extract runs, no triage rows, no analyze rows; ends idle.
   - Then **Triage** → no re-extract, triage runs, no analyze rows; ends idle.
   - Then **Analyze** → no re-extract, no re-triage, only analyze runs; ends idle (no summary).
   - Fresh request → **Triage** → extract auto-runs, then triage; no analyze; ends idle.
   - Fresh request → **Analyze** → extract → triage → analyze; no summarize; ends idle.
   - `handleWmsvStartAnalysis` (Start Analysis full run) → full pipeline including summarize → `status='complete'`.
3. Confirm cancelled-job cleanup still scopes by `analysis_run_id` (no accidental cross-run deletes).

## Out of scope

- No UI label changes for the three buttons.
- No change to credit gating.
- Summarize phase remains unreachable from these three buttons; the only way to reach it is the existing full-run path.
