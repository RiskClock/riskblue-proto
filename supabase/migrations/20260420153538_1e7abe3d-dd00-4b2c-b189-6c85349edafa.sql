-- 1. Add credit balance to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS credits_balance integer NOT NULL DEFAULT 0;

-- 2. Credit transactions audit table
CREATE TABLE IF NOT EXISTS public.credit_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  delta integer NOT NULL,
  reason text NOT NULL,
  analysis_request_id uuid,
  stripe_session_id text UNIQUE,
  package_label text,
  amount_cents integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_id ON public.credit_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_created_at ON public.credit_transactions(created_at DESC);

ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own credit transactions"
  ON public.credit_transactions
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Internal users can view all credit transactions"
  ON public.credit_transactions
  FOR SELECT
  USING (public.is_internal_user(auth.uid()));

-- No INSERT/UPDATE/DELETE policies — only service role / SECURITY DEFINER functions can modify

-- 3. Atomic credit consumption
CREATE OR REPLACE FUNCTION public.consume_credit(
  p_user_id uuid,
  p_analysis_request_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance integer;
BEGIN
  -- Lock the profile row to prevent race conditions
  SELECT credits_balance INTO v_balance
  FROM public.profiles
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF v_balance IS NULL THEN
    RETURN jsonb_build_object('success', false, 'balance', 0, 'reason', 'no_profile');
  END IF;

  IF v_balance < 1 THEN
    RETURN jsonb_build_object('success', false, 'balance', v_balance, 'reason', 'insufficient_credits');
  END IF;

  UPDATE public.profiles
  SET credits_balance = credits_balance - 1,
      updated_at = now()
  WHERE user_id = p_user_id;

  INSERT INTO public.credit_transactions (user_id, delta, reason, analysis_request_id)
  VALUES (p_user_id, -1, 'triage_consumed', p_analysis_request_id);

  RETURN jsonb_build_object('success', true, 'balance', v_balance - 1);
END;
$$;

-- 4. Idempotent credit grant (called from webhook)
CREATE OR REPLACE FUNCTION public.grant_credits(
  p_user_id uuid,
  p_amount integer,
  p_reason text,
  p_package_label text DEFAULT NULL,
  p_amount_cents integer DEFAULT NULL,
  p_stripe_session_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id uuid;
  v_new_balance integer;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  -- Idempotency: if a transaction with this stripe_session_id already exists, skip
  IF p_stripe_session_id IS NOT NULL THEN
    SELECT id INTO v_existing_id
    FROM public.credit_transactions
    WHERE stripe_session_id = p_stripe_session_id;

    IF v_existing_id IS NOT NULL THEN
      SELECT credits_balance INTO v_new_balance
      FROM public.profiles
      WHERE user_id = p_user_id;
      RETURN jsonb_build_object('success', true, 'already_processed', true, 'balance', v_new_balance);
    END IF;
  END IF;

  -- Lock the profile row
  PERFORM 1 FROM public.profiles WHERE user_id = p_user_id FOR UPDATE;

  UPDATE public.profiles
  SET credits_balance = credits_balance + p_amount,
      updated_at = now()
  WHERE user_id = p_user_id
  RETURNING credits_balance INTO v_new_balance;

  IF v_new_balance IS NULL THEN
    RAISE EXCEPTION 'Profile not found for user %', p_user_id;
  END IF;

  INSERT INTO public.credit_transactions (
    user_id, delta, reason, package_label, amount_cents, stripe_session_id
  ) VALUES (
    p_user_id, p_amount, p_reason, p_package_label, p_amount_cents, p_stripe_session_id
  );

  RETURN jsonb_build_object('success', true, 'already_processed', false, 'balance', v_new_balance);
END;
$$;

-- 5. Enable realtime on profiles so the credit balance updates live in the UI
ALTER TABLE public.profiles REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;