CREATE OR REPLACE FUNCTION public.consume_credits(p_user_id uuid, p_amount integer, p_analysis_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_balance integer;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'balance', 0, 'reason', 'invalid_amount');
  END IF;

  -- Lock the profile row to prevent race conditions
  SELECT credits_balance INTO v_balance
  FROM public.profiles
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF v_balance IS NULL THEN
    RETURN jsonb_build_object('success', false, 'balance', 0, 'reason', 'no_profile');
  END IF;

  IF v_balance < p_amount THEN
    RETURN jsonb_build_object('success', false, 'balance', v_balance, 'required', p_amount, 'reason', 'insufficient_credits');
  END IF;

  UPDATE public.profiles
  SET credits_balance = credits_balance - p_amount,
      updated_at = now()
  WHERE user_id = p_user_id;

  INSERT INTO public.credit_transactions (user_id, delta, reason, analysis_request_id)
  VALUES (p_user_id, -p_amount, 'analysis_consumed', p_analysis_request_id);

  RETURN jsonb_build_object('success', true, 'balance', v_balance - p_amount, 'consumed', p_amount);
END;
$function$;