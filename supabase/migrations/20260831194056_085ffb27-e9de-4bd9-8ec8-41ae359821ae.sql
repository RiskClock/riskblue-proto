CREATE OR REPLACE FUNCTION public.consume_tenant_credits(
  p_tenant_id uuid,
  p_amount integer,
  p_analysis_request_id uuid DEFAULT NULL::uuid,
  p_project_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_balance integer;
  v_caller uuid := auth.uid();
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_amount');
  END IF;

  IF v_caller IS NOT NULL
     AND NOT public.is_internal_user(v_caller)
     AND NOT public.tenant_has_permission(v_caller, p_tenant_id, 'create_project') THEN
    RETURN jsonb_build_object('success', false, 'reason', 'forbidden');
  END IF;

  SELECT credits_balance INTO v_balance
  FROM public.tenants WHERE id = p_tenant_id FOR UPDATE;

  IF v_balance IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'no_tenant');
  END IF;

  IF v_balance < p_amount THEN
    RETURN jsonb_build_object('success', false, 'balance', v_balance, 'required', p_amount, 'reason', 'insufficient_credits');
  END IF;

  UPDATE public.tenants
  SET credits_balance = credits_balance - p_amount, updated_at = now()
  WHERE id = p_tenant_id;

  INSERT INTO public.tenant_credit_transactions (tenant_id, delta, reason, actor_user_id, analysis_request_id, project_id)
  VALUES (p_tenant_id, -p_amount, 'analysis_consumed', v_caller, p_analysis_request_id, p_project_id);

  RETURN jsonb_build_object('success', true, 'balance', v_balance - p_amount, 'consumed', p_amount);
END;
$function$;

REVOKE ALL ON FUNCTION public.consume_tenant_credits(uuid, integer, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.consume_tenant_credits(uuid, integer, uuid, uuid) TO authenticated, service_role;