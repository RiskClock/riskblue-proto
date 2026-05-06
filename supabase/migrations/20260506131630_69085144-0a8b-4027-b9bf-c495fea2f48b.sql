UPDATE public.analysis_pipeline_jobs
SET status='pending', worker_id=NULL, claimed_at=NULL, started_at=NULL,
    next_attempt_at=now(), error_message='Reset after worker memory limit'
WHERE analysis_request_id='df286b55-07c7-41f1-a548-df4474aeb168'
  AND job_kind='split_pdf_chunk'
  AND status IN ('processing','pending');