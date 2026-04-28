ALTER TABLE public.password_reset_tokens
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'password_reset';

ALTER TABLE public.password_reset_tokens
  DROP CONSTRAINT IF EXISTS password_reset_tokens_purpose_check;

ALTER TABLE public.password_reset_tokens
  ADD CONSTRAINT password_reset_tokens_purpose_check
  CHECK (purpose IN ('account_setup', 'password_reset', 'email_change'));

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_purpose_token
  ON public.password_reset_tokens (purpose, token);