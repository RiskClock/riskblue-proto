-- Disable RLS on password_reset_tokens table
-- This table is only accessed by edge functions using service role
-- which bypasses RLS anyway, but having RLS enabled with no policies
-- can cause issues in some configurations
ALTER TABLE public.password_reset_tokens DISABLE ROW LEVEL SECURITY;