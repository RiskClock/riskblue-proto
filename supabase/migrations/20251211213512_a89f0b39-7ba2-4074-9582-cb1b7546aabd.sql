-- Create table to store Google Drive tokens separately from auth
CREATE TABLE public.user_drive_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  access_token text NOT NULL,
  refresh_token text,
  token_expiry timestamptz,
  google_email text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id)
);

-- Enable RLS
ALTER TABLE public.user_drive_tokens ENABLE ROW LEVEL SECURITY;

-- Users can only see/modify their own tokens
CREATE POLICY "Users can view own drive tokens" ON public.user_drive_tokens
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own drive tokens" ON public.user_drive_tokens
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own drive tokens" ON public.user_drive_tokens
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own drive tokens" ON public.user_drive_tokens
  FOR DELETE USING (auth.uid() = user_id);

-- Add trigger for updated_at
CREATE TRIGGER update_user_drive_tokens_updated_at
  BEFORE UPDATE ON public.user_drive_tokens
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();