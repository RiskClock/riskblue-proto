
-- Create user_procore_tokens table (mirrors user_drive_tokens)
CREATE TABLE public.user_procore_tokens (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE,
  access_token text NOT NULL DEFAULT '',
  refresh_token text,
  encrypted_access_token text,
  encrypted_refresh_token text,
  is_encrypted boolean DEFAULT false,
  token_expiry timestamptz,
  procore_email text,
  procore_company_id bigint,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.user_procore_tokens ENABLE ROW LEVEL SECURITY;

-- RLS policies: users can only access their own tokens
CREATE POLICY "Users can view own procore tokens"
  ON public.user_procore_tokens FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own procore tokens"
  ON public.user_procore_tokens FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own procore tokens"
  ON public.user_procore_tokens FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own procore tokens"
  ON public.user_procore_tokens FOR DELETE
  USING (auth.uid() = user_id);

-- Trigger for updated_at
CREATE TRIGGER update_user_procore_tokens_updated_at
  BEFORE UPDATE ON public.user_procore_tokens
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
