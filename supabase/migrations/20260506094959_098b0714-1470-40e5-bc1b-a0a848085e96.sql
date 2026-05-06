-- Backfill orphaned analysis_results rows that are missing analysis_run_id.
-- These rows were created by a prior bug where analyze-drawings could upsert
-- analysis_run_id=NULL when invoked without the runId, causing the run-scoped
-- frontend query to hide them. Repair by adopting the parent request's
-- current analysis_run_id.
UPDATE public.analysis_results r
SET analysis_run_id = ar.analysis_run_id
FROM public.analysis_requests ar
WHERE r.analysis_request_id = ar.id
  AND r.analysis_run_id IS NULL
  AND ar.analysis_run_id IS NOT NULL;