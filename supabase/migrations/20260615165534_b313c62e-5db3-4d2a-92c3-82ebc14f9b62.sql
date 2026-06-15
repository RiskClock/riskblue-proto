CREATE OR REPLACE FUNCTION public.watchdog_stalled_pipelines()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer;
BEGIN
  WITH stalled AS (
    UPDATE public.analysis_requests
    SET
      status = 'failed',
      error_message = 'Pipeline stalled: no progress for >10 minutes in phase ' || COALESCE(pipeline_phase, 'unknown') || '. Click the phase button to resume.',
      updated_at = now()
    WHERE status = 'processing'
      AND pipeline_phase IN (
        'splitting','extracting','triaging','analyzing','summarizing','dispatching_analyze'
      )
      AND COALESCE(pipeline_stop_requested, false) = false
      AND updated_at < now() - interval '10 minutes'
    RETURNING id
  )
  SELECT count(*)::int INTO v_updated FROM stalled;

  RETURN COALESCE(v_updated, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.watchdog_stalled_pipelines() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.watchdog_stalled_pipelines() TO service_role;

-- Schedule (every 2 minutes). Drop any prior schedule with the same name first.
DO $$
BEGIN
  PERFORM cron.unschedule('watchdog-stalled-pipelines');
EXCEPTION WHEN OTHERS THEN
  -- no prior schedule; ignore
  NULL;
END $$;

SELECT cron.schedule(
  'watchdog-stalled-pipelines',
  '*/2 * * * *',
  $cron$ SELECT public.watchdog_stalled_pipelines(); $cron$
);