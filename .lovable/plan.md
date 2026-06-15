# Fix stuck Extract Context + prevent it from happening again

## Root cause (corrected)
"Combined Mech - Brownlow.pdf" (51 pages) is stuck because the Extract phase runs as a sequential in-process loop calling `triage-drawings` per sheet inside one edge function invocation. With 163 sheets, the invocation hit the edge runtime wall-time limit at sheet 111. The row was left at `pipeline_phase='extracting'` with no jobs queued and no watchdog, so nothing ever resumes it.

The split→extract handoff actually worked. The real gaps are: (a) the extract phase isn't resumable, (b) the UI's "already run, overwrite?" confirm forces a full restart even when most work is done, and (c) there's no watchdog to surface stalled runs.

## Changes

### 1. Backend — `supabase/functions/run-analysis-pipeline/index.ts`
- Accept a new body flag `resumeExtract: boolean`.
- When `phaseOverride === 'extract'` AND (`resumeExtract === true` OR the request row is already `pipeline_phase='extracting'` with some sheets still `extract_status='pending'`), treat extract like backfill: only process sheets where `extract_status != 'extracted'` and `extracted_text` is empty. Do not clear anything.
- Keep existing behavior for explicit full re-run.

### 2. Frontend — `src/pages/WorkbenchProjectDetail.tsx` (`runPipeline('extract')`)
Three-way branch on Extract Context click:
- **Stalled / partial** (any sheet `extract_status='pending'` OR `pipeline_phase='extracting'`):
  Confirm `"Resume extracting context? X of Y sheets remaining."` → invoke with `{ phaseOverride: 'extract', resumeExtract: true }`. **Do not clear sheets.**
- **All sheets already extracted**:
  Keep current `"Extract Context has already run… Re-run and overwrite?"` → clear + full re-run (current behavior).
- **Fresh**:
  Run as today.

### 3. Watchdog — pg_cron via `supabase--migration`
Add `public.watchdog_stalled_pipelines()` and a 2-minute pg_cron schedule:
- Find `analysis_requests` where `status='processing'` AND `pipeline_phase IN ('splitting','extracting','triaging','analyzing','summarizing','dispatching_analyze')` AND `updated_at < now() - interval '10 minutes'`.
- Set `status='failed'`, `error_message='Pipeline stalled: no progress for >10 minutes in phase <phase>. Click the phase button to resume.'`. This unblocks the UI (button returns to idle) without losing partial progress (extracted sheets stay extracted).
- Excludes `pipeline_stop_requested=true` rows.

### 4. Unstick the current row (one-time)
Use `supabase--insert` to reset request `edb96f71-5db8-44cb-b55e-bb5854af3b29` so the user can click Extract Context and get the new "Resume extracting? 51 of 163 sheets remaining" path immediately. No sheet data is touched.

## Files touched
- `supabase/functions/run-analysis-pipeline/index.ts` — add `resumeExtract` flag + skip-already-extracted filter when set.
- `src/pages/WorkbenchProjectDetail.tsx` — branch Extract Context handler; suppress sheet wipe on resume.
- Migration — `watchdog_stalled_pipelines()` function + pg_cron schedule.
- Data fix — reset the one stuck row.

## Out of scope (intentionally)
- Not converting Extract into a job-queue–driven phase (bigger refactor). Resumability + watchdog cover the failure mode end-to-end for now; if Extract phase keeps stalling on very large uploads we revisit then.
