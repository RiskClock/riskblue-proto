CREATE OR REPLACE FUNCTION public.seed_analysis_worker_secret(p_secret TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  -- Upsert by name
  SELECT id INTO v_id FROM vault.secrets WHERE name = 'analysis_worker_secret';
  IF v_id IS NULL THEN
    PERFORM vault.create_secret(p_secret, 'analysis_worker_secret', 'Worker secret for process-analysis-jobs cron');
  ELSE
    PERFORM vault.update_secret(v_id, p_secret, 'analysis_worker_secret', 'Worker secret for process-analysis-jobs cron');
  END IF;
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_analysis_worker_secret(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_analysis_worker_secret(TEXT) TO service_role;