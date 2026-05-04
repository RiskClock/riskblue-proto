ALTER TABLE public.analysis_pipeline_jobs
  ADD CONSTRAINT analysis_pipeline_jobs_request_fk
  FOREIGN KEY (analysis_request_id)
  REFERENCES public.analysis_requests(id)
  ON DELETE CASCADE;