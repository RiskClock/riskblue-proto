-- Enable RLS on password_reset_tokens with deny-all policies
-- Edge functions use service role which bypasses RLS, so this is safe
ALTER TABLE public.password_reset_tokens ENABLE ROW LEVEL SECURITY;

-- Create deny-all policy - no direct client access allowed
-- Only edge functions using service role can access this table
CREATE POLICY "No direct access to reset tokens"
ON public.password_reset_tokens
FOR ALL
USING (false)
WITH CHECK (false);