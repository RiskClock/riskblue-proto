-- 1) Backfill missing run ids on analysis_requests so children can inherit
UPDATE public.analysis_requests
SET analysis_run_id = gen_random_uuid()
WHERE analysis_run_id IS NULL;

-- 2) Add columns
ALTER TABLE public.analysis_results
  ADD COLUMN IF NOT EXISTS analysis_run_id uuid;

ALTER TABLE public.analysis_triage_results
  ADD COLUMN IF NOT EXISTS analysis_run_id uuid;

-- 3) Backfill children from parent request
UPDATE public.analysis_results r
SET analysis_run_id = ar.analysis_run_id
FROM public.analysis_requests ar
WHERE r.analysis_request_id = ar.id
  AND r.analysis_run_id IS NULL;

UPDATE public.analysis_triage_results t
SET analysis_run_id = ar.analysis_run_id
FROM public.analysis_requests ar
WHERE t.analysis_request_id = ar.id
  AND t.analysis_run_id IS NULL;

-- 4) Indexes
CREATE INDEX IF NOT EXISTS idx_analysis_results_request_run
  ON public.analysis_results (analysis_request_id, analysis_run_id);

CREATE INDEX IF NOT EXISTS idx_analysis_triage_results_request_run
  ON public.analysis_triage_results (analysis_request_id, analysis_run_id);