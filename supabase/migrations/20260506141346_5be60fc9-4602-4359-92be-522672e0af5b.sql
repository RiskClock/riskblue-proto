-- Reap stuck split_pdf_chunk jobs for test7 and reset request
UPDATE public.analysis_pipeline_jobs
SET status='cancelled', completed_at=now(), error_message='Reaped: worker memory limit, stop pressed'
WHERE analysis_request_id='df286b55-07c7-41f1-a548-df4474aeb168'
  AND job_kind='split_pdf_chunk'
  AND status IN ('pending','processing');

UPDATE public.analysis_requests
SET status='started',
    pipeline_phase=NULL,
    pipeline_stop_requested=false,
    pipeline_progress_done=0,
    pipeline_progress_total=0,
    error_message='Stopped during split phase (worker memory limit). Please retry.'
WHERE id='df286b55-07c7-41f1-a548-df4474aeb168';