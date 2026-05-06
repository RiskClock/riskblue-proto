-- Convert legacy full-unique indexes to partial (legacy file-level only, sheet_id IS NULL)
-- so sheet-mode rows can co-exist (multiple sheets per parent file).

-- analysis_pipeline_jobs: legacy file-level unique
ALTER TABLE public.analysis_pipeline_jobs
  DROP CONSTRAINT IF EXISTS analysis_pipeline_jobs_request_file_class_kind_uq;
DROP INDEX IF EXISTS public.analysis_pipeline_jobs_request_file_class_kind_uq;
CREATE UNIQUE INDEX IF NOT EXISTS analysis_pipeline_jobs_request_file_class_kind_uq
  ON public.analysis_pipeline_jobs (analysis_request_id, file_id, awp_class_name, job_kind)
  WHERE sheet_id IS NULL;

-- Per-sheet uniqueness (job_kind included so triage + analyze don't collide on the same sheet)
DROP INDEX IF EXISTS public.uniq_analysis_pipeline_jobs_sheet_kind;
CREATE UNIQUE INDEX uniq_analysis_pipeline_jobs_sheet_kind
  ON public.analysis_pipeline_jobs (analysis_request_id, sheet_id, awp_class_name, job_kind)
  WHERE sheet_id IS NOT NULL;

-- analysis_triage_results: legacy full unique → partial
ALTER TABLE public.analysis_triage_results
  DROP CONSTRAINT IF EXISTS analysis_triage_results_analysis_request_id_file_id_awp_cla_key;
DROP INDEX IF EXISTS public.analysis_triage_results_analysis_request_id_file_id_awp_cla_key;
CREATE UNIQUE INDEX IF NOT EXISTS analysis_triage_results_request_file_class_legacy_uq
  ON public.analysis_triage_results (analysis_request_id, file_id, awp_class_name)
  WHERE sheet_id IS NULL;

-- analysis_results: legacy full unique(s) → partial
DROP INDEX IF EXISTS public.idx_analysis_results_unique;
DROP INDEX IF EXISTS public.uq_analysis_results_active;
CREATE UNIQUE INDEX IF NOT EXISTS analysis_results_request_file_class_legacy_uq
  ON public.analysis_results (analysis_request_id, file_id, awp_class_name)
  WHERE sheet_id IS NULL;
