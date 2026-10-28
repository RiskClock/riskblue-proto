ALTER TABLE public.analysis_requests
  ADD COLUMN IF NOT EXISTS import_status text,
  ADD COLUMN IF NOT EXISTS requested_files jsonb,
  ADD COLUMN IF NOT EXISTS import_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS import_next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS import_claimed_at timestamptz;

ALTER TABLE public.analysis_requests
  ADD CONSTRAINT analysis_requests_import_status_check
  CHECK (import_status IS NULL OR import_status IN ('queued','importing','ready','failed'));

CREATE INDEX IF NOT EXISTS analysis_requests_import_queue_idx
  ON public.analysis_requests (import_status, import_next_attempt_at)
  WHERE import_status IN ('queued','importing');

-- Queued cloud imports always run with the requester's own provider tokens.
CREATE OR REPLACE FUNCTION public.guard_cloud_import_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW; -- service role / worker
  END IF;
  IF NEW.import_status IS NOT NULL OR NEW.requested_files IS NOT NULL THEN
    IF NEW.user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Cloud imports must belong to the requesting user';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.user_id IS DISTINCT FROM NEW.user_id THEN
      RAISE EXCEPTION 'Cloud import owner cannot change';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_cloud_import_owner ON public.analysis_requests;
CREATE TRIGGER guard_cloud_import_owner
  BEFORE INSERT OR UPDATE ON public.analysis_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_cloud_import_owner();

CREATE OR REPLACE FUNCTION public.claim_cloud_imports(p_batch integer DEFAULT 3)
RETURNS SETOF public.analysis_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Reclaim imports whose worker died mid-copy.
  UPDATE public.analysis_requests
  SET import_status = 'queued', import_next_attempt_at = now()
  WHERE import_status = 'importing'
    AND import_claimed_at < now() - interval '15 minutes';

  RETURN QUERY
  UPDATE public.analysis_requests
  SET import_status = 'importing',
      import_claimed_at = now(),
      import_attempts = import_attempts + 1
  WHERE id IN (
    SELECT id FROM public.analysis_requests
    WHERE import_status = 'queued'
      AND COALESCE(import_next_attempt_at, now()) <= now()
    ORDER BY created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(1, LEAST(p_batch, 10))
  )
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_cloud_imports(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_cloud_imports(integer) TO service_role;

CREATE TABLE public.user_autodesk_tokens (
  user_id uuid PRIMARY KEY,
  encrypted_access_token text NOT NULL,
  encrypted_refresh_token text,
  token_expiry timestamptz,
  autodesk_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, DELETE ON public.user_autodesk_tokens TO authenticated;
GRANT ALL ON public.user_autodesk_tokens TO service_role;
ALTER TABLE public.user_autodesk_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own autodesk connection"
  ON public.user_autodesk_tokens FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own autodesk connection"
  ON public.user_autodesk_tokens FOR DELETE TO authenticated
  USING (auth.uid() = user_id);