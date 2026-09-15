CREATE OR REPLACE FUNCTION public.staff_user_ids()
RETURNS TABLE(user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id FROM auth.users u
  WHERE lower(u.email) LIKE '%@riskclock.com'
  UNION
  SELECT ur.user_id FROM public.user_roles ur WHERE ur.role = 'system_admin'::public.app_role;
$$;

REVOKE EXECUTE ON FUNCTION public.staff_user_ids() FROM anon;
GRANT EXECUTE ON FUNCTION public.staff_user_ids() TO authenticated, service_role;