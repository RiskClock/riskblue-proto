
CREATE TABLE IF NOT EXISTS public.user_sharepoint_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  access_token text NOT NULL DEFAULT '',
  refresh_token text,
  encrypted_access_token text,
  encrypted_refresh_token text,
  is_encrypted boolean DEFAULT false,
  token_expiry timestamptz,
  sharepoint_email text,
  refreshing_since timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.user_sharepoint_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own sharepoint token"
  ON public.user_sharepoint_tokens FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own sharepoint token"
  ON public.user_sharepoint_tokens FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own sharepoint token"
  ON public.user_sharepoint_tokens FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own sharepoint token"
  ON public.user_sharepoint_tokens FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_user_sharepoint_tokens_updated_at
  BEFORE UPDATE ON public.user_sharepoint_tokens
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
