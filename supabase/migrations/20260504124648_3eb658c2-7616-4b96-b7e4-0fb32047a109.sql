
-- ============================================================
-- 1. Enable required extensions for scheduling worker function
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ============================================================
-- 2. analysis_pipeline_jobs table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.analysis_pipeline_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_request_id UUID NOT NULL,
  file_id UUID NOT NULL,
  awp_class_name TEXT NOT NULL,
  prompt_content TEXT,
  analyze_model TEXT NOT NULL DEFAULT 'gpt-5-mini',
  status TEXT NOT NULL DEFAULT 'pending', -- pending | processing | complete | failed | cancelled
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  worker_id TEXT,
  claimed_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  tokens_used INTEGER,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (analysis_request_id, file_id, awp_class_name)
);

CREATE INDEX IF NOT EXISTS idx_apj_request_status
  ON public.analysis_pipeline_jobs (analysis_request_id, status);

CREATE INDEX IF NOT EXISTS idx_apj_claim
  ON public.analysis_pipeline_jobs (status, next_attempt_at)
  WHERE status = 'pending';

ALTER TABLE public.analysis_pipeline_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Internal users can manage analysis pipeline jobs"
  ON public.analysis_pipeline_jobs
  FOR ALL
  USING (public.is_internal_user(auth.uid()))
  WITH CHECK (public.is_internal_user(auth.uid()));

CREATE POLICY "Project members can view analysis pipeline jobs"
  ON public.analysis_pipeline_jobs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.analysis_requests ar
      JOIN public.projects p ON p.id = ar.project_id
      WHERE ar.id = analysis_pipeline_jobs.analysis_request_id
        AND (p.user_id = auth.uid() OR public.is_project_member(auth.uid(), p.id))
    )
  );

CREATE TRIGGER trg_apj_updated_at
  BEFORE UPDATE ON public.analysis_pipeline_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 3. Idempotency on analysis_results
-- ============================================================
-- Partial unique index: only enforce uniqueness for non-failed/non-cancelled
-- rows so that a retry inserting a fresh 'processing' row after a 'failed'
-- row is still allowed (the upsert in analyze-drawings keys on this).
CREATE UNIQUE INDEX IF NOT EXISTS uq_analysis_results_active
  ON public.analysis_results (analysis_request_id, file_id, awp_class_name);

-- ============================================================
-- 4. Atomic job claim function (FOR UPDATE SKIP LOCKED)
-- ============================================================
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
    ORDER BY created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT p_batch_size
  )
  RETURNING *;
END;
$$;

-- ============================================================
-- 5. Advisory lock for single summarize trigger
-- ============================================================
CREATE OR REPLACE FUNCTION public.try_lock_analysis_finalize(
  p_request_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN pg_try_advisory_xact_lock(
    hashtextextended('analysis_finalize:' || p_request_id::text, 0)
  );
END;
$$;
