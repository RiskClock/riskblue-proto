-- Cap concurrent in-flight jobs across cron invocations
CREATE OR REPLACE FUNCTION public.claim_next_analysis_jobs(p_worker_id text, p_batch_size integer DEFAULT 5)
 RETURNS SETOF analysis_pipeline_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inflight integer;
  v_available integer;
BEGIN
  -- Count jobs already being processed by other worker invocations
  SELECT COUNT(*)::int INTO v_inflight
  FROM public.analysis_pipeline_jobs
  WHERE status = 'processing';

  v_available := GREATEST(0, p_batch_size - v_inflight);

  IF v_available = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE public.analysis_pipeline_jobs
  SET status = 'processing',
      worker_id = p_worker_id,
      claimed_at = now(),
      started_at = COALESCE(started_at, now()),
      attempts = attempts + 1
  WHERE id IN (
    SELECT id
    FROM public.analysis_pipeline_jobs
    WHERE status = 'pending'
      AND next_attempt_at <= now()
    ORDER BY sort_order ASC, created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT v_available
  )
  RETURNING *;
END;
$function$;