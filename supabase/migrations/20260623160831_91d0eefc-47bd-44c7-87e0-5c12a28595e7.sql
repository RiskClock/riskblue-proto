CREATE OR REPLACE FUNCTION public.cleanup_request_storage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
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
    RAISE WARNING 'cleanup_request_storage: analysis_worker_secret not found in vault — skipping';
    RETURN OLD;
  END IF;

  PERFORM net.http_post(
    url := 'https://qbzuchzqeefbzeldftvg.supabase.co/functions/v1/delete-request-storage',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-worker-secret', v_secret
    ),
    body := jsonb_build_object('requestId', OLD.id)
  );
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_request_storage ON public.analysis_requests;
CREATE TRIGGER trg_cleanup_request_storage
AFTER DELETE ON public.analysis_requests
FOR EACH ROW
EXECUTE FUNCTION public.cleanup_request_storage();