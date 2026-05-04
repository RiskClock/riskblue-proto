-- 1. Add sort_order to analysis_pipeline_jobs
ALTER TABLE public.analysis_pipeline_jobs
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 1000;

CREATE INDEX IF NOT EXISTS idx_apj_claim_sorted
  ON public.analysis_pipeline_jobs (status, next_attempt_at, sort_order)
  WHERE status = 'pending';

-- 2. Update claim function to order by sort_order
CREATE OR REPLACE FUNCTION public.claim_next_analysis_jobs(
  p_worker_id TEXT,
  p_batch_size INTEGER DEFAULT 5
)
RETURNS SETOF public.analysis_pipeline_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
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
    LIMIT p_batch_size
  )
  RETURNING *;
END;
$$;

-- 3. Backfill sort_order for existing pending jobs based on canonical class order
WITH class_order AS (
  SELECT name, display_order AS ord, 0 AS bucket
  FROM public.critical_assets WHERE is_active = true
  UNION ALL
  SELECT name, display_order AS ord, 1 AS bucket
  FROM public.water_systems WHERE is_active = true
  UNION ALL
  SELECT name, display_order AS ord, 2 AS bucket
  FROM public.processes WHERE is_active = true
)
UPDATE public.analysis_pipeline_jobs j
SET sort_order = (co.bucket * 1000) + co.ord
FROM class_order co
WHERE j.awp_class_name = co.name
  AND j.status = 'pending';

-- 4. Store secrets in Vault for cron job to use
DO $$
BEGIN
  -- Use vault.create_secret if available; fall back to insert/update
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'analysis_worker_secret') THEN
    PERFORM vault.create_secret(
      current_setting('app.settings.analysis_worker_secret', true),
      'analysis_worker_secret',
      'Worker secret for process-analysis-jobs cron'
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- Vault may not be available or already populated; ignore.
  NULL;
END $$;

-- 5. Schedule the worker via pg_cron (every 30 seconds).
-- Unschedule any prior version first to make this idempotent.
DO $$
BEGIN
  PERFORM cron.unschedule('process-analysis-jobs-every-30s');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'process-analysis-jobs-every-30s',
  '30 seconds',
  $cron$
  SELECT net.http_post(
    url := 'https://qbzuchzqeefbzeldftvg.supabase.co/functions/v1/process-analysis-jobs',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-worker-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'analysis_worker_secret' LIMIT 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $cron$
);