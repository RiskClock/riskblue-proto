
# Triage queueing — fix Phase 2 timeout

## Problem (confirmed from Brownlow data)

Phase 2 (triage) runs inside `run-analysis-pipeline` via an inline `runPool` that synchronously awaits `triage-drawings` calls. Each triage call takes 20–50s and the edge runtime caps the function at ~400s wall clock. For Brownlow Mechanical (102 items × ~25s ÷ 5 concurrency ≈ 510s) the function was killed mid-loop:

- progress stopped at 65/102
- only 35 of 51 files had triage rows
- pipeline_phase stuck at `triaging` (never reached `safeWriteComplete`)
- Phase 3 never started; the 16 analysis_results visible in the UI were leftovers from a previous run

This will get worse, not better, after sheet normalization (more triage items per request).

## Solution

Move triage to the same job-queue model Phase 3 already uses. The pipeline enqueues triage rows, kicks the worker, and returns. The cron-driven worker drains jobs in batches, then transitions the request to Phase 3 when all triage jobs are terminal.

## Scope (keep tight)

This change is independent of sheet normalization and runs on file-level triage today. After validation it transparently extends to sheet-level triage (jobs simply reference more files).

## Changes

### 1. `process-analysis-jobs/index.ts`

Add `triage` job_kind handler and a triage-phase finalizer.

- `runJob` routes `job_kind === 'triage'` to a new `runTriageJob`.
- `runTriageJob`:
  - Honors stop-requested + run-id supersede checks (mirror of `runJob` analyze path).
  - Calls `triage-drawings` with internal service-role auth + `x-internal-invocation` header, body `{ analysisRequestId, analysisRunId, fileId, awpClassName, assetType, drawingName, promptContent, action: "triage", model }`.
  - Per-call timeout 60s (triage is slower than analyze for some PDFs); on timeout/error, retry with same exponential backoff used today (30s/60s/120s).
  - On 409 → mark cancelled (superseded). On success → mark complete, accumulate `triage_tokens_used` atomically (mirror of analyze tokens block).
- Job row carries: `awp_class_name`, `prompt_content` (the triage prompt), `analyze_model` reused as the triage model column (rename column is out of scope — store the triage model string here so we don't add migrations).
- Worker progress updater (`updateProgress`) already recounts terminal jobs for the request — works for both phases.
- New `maybeFinalizeTriage` (parallel to `maybeFinalize`):
  - When `pipeline_phase === 'triaging'` and zero pending/processing triage jobs remain for this run, atomically flip `pipeline_phase` to `analyzing-pending` (transient marker) and fire-and-forget invoke `run-analysis-pipeline` with `phaseOverride: "analyze"` and `x-internal-invocation` so it picks up at Phase 3.
  - Stop-requested handling: cancel pending triage jobs, set status=`started`, clear phase (mirror of analyze stop path).
- `checkFinalizeAllAnalyzing` → rename to `checkFinalizeAll` and also scan rows where `pipeline_phase === 'triaging'`, calling the triage finalizer.
- Touched-keys finalize loop in main handler runs both finalizers based on the job_kind seen in this batch (or just call both — they're cheap and idempotent).

### 2. `run-analysis-pipeline/index.ts` — Phase 2 rewrite

Replace the inline `runPool` block (lines ~1080–1195) with the same enqueue-then-return pattern Phase 3 uses:

- Build `triageItems` exactly as today (file × prompt cross-product).
- Clear stale triage jobs for this request before insert: `delete from analysis_pipeline_jobs where analysis_request_id=$1 and job_kind='triage'`.
- Bulk insert job rows in chunks of 500:
  ```
  { analysis_request_id, analysis_run_id, file_id, awp_class_name,
    prompt_content: triagePromptContent, analyze_model: triageModel,
    job_kind: 'triage', status: 'pending', sort_order: orderFor(class) }
  ```
- Set `pipeline_phase='triaging'`, `pipeline_progress_total=triageItems.length`, `pipeline_progress_done=0`, `status='processing'`.
- Kick the worker (existing 2s-abort fetch pattern from Phase 3).
- Return. Do NOT continue into Phase 3 in this invocation.

When the worker finalizes triage, it re-invokes the pipeline with `phaseOverride='analyze'`, which already reads triage results, builds the work queue, and enqueues analyze jobs.

### 3. `phaseOverride='analyze'` entry path

The existing `phaseOverride='analyze'` branch already handles cleanup correctly (it deletes only stale results, not triage). Verify the pipeline header treats `phaseOverride='analyze'` like an internal worker re-invocation (uses service-role token, doesn't re-clear results) — same pattern already in place for `phaseOverride='summarize'`.

### 4. Defensive: clear stuck `pipeline_phase` on supersede

In `safeWriteComplete` and the supersede branches, ensure `pipeline_phase=null` is written so a dead run cannot leave a row in the inconsistent state Brownlow exhibits (`status=complete` + `pipeline_phase=triaging`). Already partially done — extend to the supersede paths in `phaseOverride` handler.

## What does NOT change

- `triage-drawings` function (unchanged inputs/outputs).
- `analysis_triage_results` table and writes (still done by triage-drawings).
- Phase 0 (split), Phase 1 (extract), Phase 3 (analyze), Phase 4 (summarize) — all unchanged.
- Sheet normalization flag — still off by default. This fix is independent.
- No DB schema changes. `analysis_pipeline_jobs.job_kind` already exists (`split_pdf_chunk` precedent). `analyze_model` column reused for triage model (cosmetic; can be renamed later).

## Verification before re-running Brownlow

1. Reset Brownlow Mechanical: clear stale `pipeline_phase`, run analyze fresh.
2. Watch `analysis_pipeline_jobs` populate with `job_kind='triage'` rows.
3. Confirm worker drains in 30s cron ticks; no inline pipeline call exceeds 30s.
4. Confirm transition to `analyzing` happens automatically once all triage jobs terminal.
5. Confirm `pipeline_phase` clears at the end of the run.

## Out of scope (future)

- Sheet-level triage (will work transparently when normalization flag flips).
- Renaming `analyze_model` → `model` on the jobs table.
- Phase 1 (extract) is also synchronous but each call is fast (<5s); only move to queue if Brownlow data shows it timing out.
