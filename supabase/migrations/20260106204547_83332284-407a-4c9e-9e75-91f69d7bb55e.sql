-- Fix the is_internal_user function to use ILIKE for case-insensitive matching
CREATE OR REPLACE FUNCTION public.is_internal_user(_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((auth.jwt()->>'email') ILIKE '%@riskclock.com', false)
$$;