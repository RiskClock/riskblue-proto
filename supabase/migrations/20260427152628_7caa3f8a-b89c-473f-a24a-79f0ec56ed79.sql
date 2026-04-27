-- Audit-safe admin credit adjustments
-- Lets the admin-users edge function set a user's balance to an arbitrary value while writing
-- a row to credit_transactions so the audit log stays consistent.
CREATE OR REPLACE FUNCTION public.admin_adjust_credits(
  p_user_id uuid,
  p_new_balance integer,
  p_actor_user_id uuid,
  p_reason text DEFAULT 'admin_adjust'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_balance integer;
  v_delta integer;
BEGIN
  IF p_new_balance < 0 THEN
    RAISE EXCEPTION 'Balance cannot be negative';
  END IF;

  -- Lock the profile row
  SELECT credits_balance INTO v_old_balance
  FROM public.profiles
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF v_old_balance IS NULL THEN
    RAISE EXCEPTION 'Profile not found for user %', p_user_id;
  END IF;

  v_delta := p_new_balance - v_old_balance;

  IF v_delta = 0 THEN
    RETURN jsonb_build_object('success', true, 'changed', false, 'balance', v_old_balance);
  END IF;

  UPDATE public.profiles
  SET credits_balance = p_new_balance,
      updated_at = now()
  WHERE user_id = p_user_id;

  INSERT INTO public.credit_transactions (user_id, delta, reason, package_label)
  VALUES (
    p_user_id,
    v_delta,
    p_reason,
    'Admin adjustment by ' || COALESCE(p_actor_user_id::text, 'system')
  );

  RETURN jsonb_build_object('success', true, 'changed', true, 'balance', p_new_balance, 'delta', v_delta);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_adjust_credits(uuid, integer, uuid, text) FROM PUBLIC;
-- Only service-role (used by admin-users edge fn) needs to call this.
