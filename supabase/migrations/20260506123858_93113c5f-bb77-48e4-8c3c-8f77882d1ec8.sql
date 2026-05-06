-- Add sheet_id to analysis_pipeline_jobs
ALTER TABLE public.analysis_pipeline_jobs
  ADD COLUMN IF NOT EXISTS sheet_id uuid NULL
    REFERENCES public.analysis_request_sheets(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_analysis_pipeline_jobs_sheet_id
  ON public.analysis_pipeline_jobs(sheet_id);

CREATE INDEX IF NOT EXISTS idx_analysis_pipeline_jobs_request_kind_status
  ON public.analysis_pipeline_jobs(analysis_request_id, job_kind, status);

-- Per-sheet uniqueness for triage results (does not conflict with legacy file-level unique)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_triage_results_sheet
  ON public.analysis_triage_results(analysis_request_id, sheet_id, awp_class_name)
  WHERE sheet_id IS NOT NULL;

-- Per-sheet uniqueness for analysis results
CREATE UNIQUE INDEX IF NOT EXISTS uniq_analysis_results_sheet
  ON public.analysis_results(analysis_request_id, sheet_id, awp_class_name)
  WHERE sheet_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_analysis_results_sheet_id
  ON public.analysis_results(sheet_id);

CREATE INDEX IF NOT EXISTS idx_analysis_triage_results_sheet_id
  ON public.analysis_triage_results(sheet_id);

-- Note: analysis_request_sheets.extract_status check already enforces canonical
-- enum (pending | extracted | failed | skipped). No change needed.