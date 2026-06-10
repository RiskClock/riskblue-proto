-- 1. Per-project notification opt-out flag
ALTER TABLE public.project_user_roles
  ADD COLUMN IF NOT EXISTS email_notifications_enabled boolean NOT NULL DEFAULT true;

-- 2. Project-created notification trigger using pg_net + worker secret
CREATE OR REPLACE FUNCTION public.notify_project_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
  v_secret text;
BEGIN
  BEGIN
    SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
    WHERE name = 'analysis_worker_secret'
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_secret := NULL;
  END;

  IF v_secret IS NULL THEN
    RAISE WARNING 'notify_project_created: analysis_worker_secret not found in vault — skipping';
    RETURN NEW;
  END IF;

  -- Derive the functions URL from the current database host pattern.
  v_url := 'https://qbzuchzqeefbzeldftvg.supabase.co/functions/v1/send-project-created-email';

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-worker-secret', v_secret
    ),
    body := jsonb_build_object('projectId', NEW.id)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_project_created ON public.projects;
CREATE TRIGGER trg_notify_project_created
AFTER INSERT ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.notify_project_created();