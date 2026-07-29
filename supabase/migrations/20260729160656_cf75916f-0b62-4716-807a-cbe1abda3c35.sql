CREATE TABLE public.project_agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  analysis_request_id uuid,
  agent text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  triggered_by uuid,
  triggered_by_email text,
  started_at timestamptz NOT NULL DEFAULT now(),
  heartbeat_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error_message text
);

CREATE INDEX idx_project_agent_runs_active ON public.project_agent_runs (project_id, status, heartbeat_at DESC);

GRANT SELECT ON public.project_agent_runs TO authenticated;
GRANT ALL ON public.project_agent_runs TO service_role;

ALTER TABLE public.project_agent_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members and internal can view agent runs"
ON public.project_agent_runs
FOR SELECT
TO authenticated
USING (
  public.is_project_member(auth.uid(), project_id)
  OR public.is_internal_user(auth.uid())
);

CREATE OR REPLACE FUNCTION public.acquire_agent_run(
  p_project_id uuid,
  p_agent text,
  p_analysis_request_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_user uuid := auth.uid();
  v_email text;
  v_active public.project_agent_runs%ROWTYPE;
  v_new_id uuid;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('acquired', false, 'reason', 'unauthenticated');
  END IF;

  IF NOT (public.is_project_member(v_user, p_project_id) OR public.is_internal_user(v_user)) THEN
    RETURN jsonb_build_object('acquired', false, 'reason', 'forbidden');
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_user;

  UPDATE public.project_agent_runs
  SET status = 'stale', completed_at = now()
  WHERE project_id = p_project_id
    AND status = 'running'
    AND heartbeat_at < now() - interval '15 minutes';

  SELECT * INTO v_active
  FROM public.project_agent_runs
  WHERE project_id = p_project_id
    AND status = 'running'
  ORDER BY started_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_active.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'acquired', false,
      'reason', 'busy',
      'agent', v_active.agent,
      'email', v_active.triggered_by_email,
      'started_at', v_active.started_at,
      'run_id', v_active.id
    );
  END IF;

  INSERT INTO public.project_agent_runs (project_id, analysis_request_id, agent, triggered_by, triggered_by_email)
  VALUES (p_project_id, p_analysis_request_id, p_agent, v_user, v_email)
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object('acquired', true, 'run_id', v_new_id, 'agent', p_agent, 'email', v_email);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.heartbeat_agent_run(p_run_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  UPDATE public.project_agent_runs
  SET heartbeat_at = now()
  WHERE id = p_run_id
    AND status = 'running'
    AND triggered_by = auth.uid();
  RETURN FOUND;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.complete_agent_run(
  p_run_id uuid,
  p_status text DEFAULT 'completed',
  p_error text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  UPDATE public.project_agent_runs
  SET status = CASE WHEN p_status IN ('completed','failed','cancelled') THEN p_status ELSE 'completed' END,
      completed_at = now(),
      heartbeat_at = now(),
      error_message = p_error
  WHERE id = p_run_id
    AND status = 'running'
    AND (triggered_by = auth.uid() OR public.is_internal_user(auth.uid()));
  RETURN FOUND;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.force_release_agent_runs(p_project_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_count integer;
BEGIN
  IF NOT public.is_internal_user(auth.uid()) THEN
    RAISE EXCEPTION 'Only internal users can force-release agent runs';
  END IF;

  WITH released AS (
    UPDATE public.project_agent_runs
    SET status = 'cancelled', completed_at = now(), error_message = 'Force released'
    WHERE project_id = p_project_id AND status = 'running'
    RETURNING id
  )
  SELECT count(*)::int INTO v_count FROM released;

  RETURN COALESCE(v_count, 0);
END;
$fn$;