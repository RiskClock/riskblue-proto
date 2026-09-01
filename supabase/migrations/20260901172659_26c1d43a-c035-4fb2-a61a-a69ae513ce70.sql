CREATE OR REPLACE FUNCTION public.grant_tenant_credits(
  p_tenant_id uuid,
  p_amount integer,
  p_reason text,
  p_package_label text DEFAULT NULL,
  p_amount_cents integer DEFAULT NULL,
  p_stripe_session_id text DEFAULT NULL,
  p_actor_user_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_existing uuid;
  v_balance integer;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  IF p_stripe_session_id IS NOT NULL THEN
    SELECT id INTO v_existing FROM public.tenant_credit_transactions
    WHERE stripe_session_id = p_stripe_session_id;
    IF v_existing IS NOT NULL THEN
      SELECT credits_balance INTO v_balance FROM public.tenants WHERE id = p_tenant_id;
      RETURN jsonb_build_object('success', true, 'already_processed', true, 'balance', v_balance);
    END IF;
  END IF;

  UPDATE public.tenants
  SET credits_balance = credits_balance + p_amount, updated_at = now()
  WHERE id = p_tenant_id
  RETURNING credits_balance INTO v_balance;

  IF v_balance IS NULL THEN
    RAISE EXCEPTION 'Company not found: %', p_tenant_id;
  END IF;

  INSERT INTO public.tenant_credit_transactions
    (tenant_id, delta, reason, actor_user_id, package_label, amount_cents, stripe_session_id)
  VALUES (p_tenant_id, p_amount, p_reason, p_actor_user_id, p_package_label, p_amount_cents, p_stripe_session_id);

  RETURN jsonb_build_object('success', true, 'already_processed', false, 'balance', v_balance);
END;
$$;

-- One-off correction: move the 500 credits purchased for arkIQ from the buyer's
-- personal balance to the company pool.
DO $$
DECLARE
  v_user uuid := '327714a8-90bd-4d9d-aa2c-e6253a0dca02';
  v_tenant uuid := '2a31656b-2319-44c7-955b-6666920e09b7';
  v_session text := 'cs_test_a1tHXiCvjVcobS1bWS83GcG9h5HDZbaMq2Xwf6LVFTBIBLeK83nn8n2FYQ';
BEGIN
  IF EXISTS (SELECT 1 FROM public.credit_transactions WHERE stripe_session_id = v_session)
     AND NOT EXISTS (SELECT 1 FROM public.tenant_credit_transactions WHERE stripe_session_id = v_session) THEN
    UPDATE public.profiles SET credits_balance = GREATEST(credits_balance - 500, 0), updated_at = now()
    WHERE user_id = v_user;
    INSERT INTO public.credit_transactions (user_id, delta, reason, package_label)
    VALUES (v_user, -500, 'transfer_to_company', 'Moved to arkIQ company pool');
    PERFORM public.grant_tenant_credits(v_tenant, 500, 'purchase', '500 Scan Credits', 40000, v_session, v_user);
  END IF;
END $$;