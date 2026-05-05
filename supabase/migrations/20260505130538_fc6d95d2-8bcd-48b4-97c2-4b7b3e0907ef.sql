ALTER TABLE public.analysis_requests
  ADD COLUMN IF NOT EXISTS analysis_run_id uuid,
  ADD COLUMN IF NOT EXISTS started_at timestamptz;

ALTER TABLE public.analysis_pipeline_jobs
  ADD COLUMN IF NOT EXISTS analysis_run_id uuid;

CREATE INDEX IF NOT EXISTS idx_analysis_pipeline_jobs_run_id
  ON public.analysis_pipeline_jobs(analysis_run_id);

CREATE INDEX IF NOT EXISTS idx_analysis_requests_run_id
  ON public.analysis_requests(analysis_run_id);