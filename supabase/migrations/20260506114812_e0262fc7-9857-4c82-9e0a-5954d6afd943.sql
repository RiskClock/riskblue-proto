ALTER TABLE public.analysis_pipeline_jobs
  DROP CONSTRAINT IF EXISTS analysis_pipeline_jobs_analysis_request_id_file_id_awp_clas_key;

CREATE UNIQUE INDEX IF NOT EXISTS analysis_pipeline_jobs_request_file_class_kind_uq
  ON public.analysis_pipeline_jobs (analysis_request_id, file_id, awp_class_name, job_kind);