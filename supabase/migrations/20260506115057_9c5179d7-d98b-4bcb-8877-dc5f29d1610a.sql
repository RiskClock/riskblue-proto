DELETE FROM public.analysis_results
WHERE analysis_request_id = 'a6a59763-aeb6-4597-b345-bc3f55dfc0ae'
  AND status = 'processing';

DELETE FROM public.analysis_pipeline_jobs
WHERE analysis_request_id = 'a6a59763-aeb6-4597-b345-bc3f55dfc0ae'
  AND job_kind = 'analyze';

UPDATE public.analysis_requests
SET error_message = NULL,
    pipeline_phase = NULL,
    pipeline_progress_done = 0,
    pipeline_progress_total = 0
WHERE id = 'a6a59763-aeb6-4597-b345-bc3f55dfc0ae';