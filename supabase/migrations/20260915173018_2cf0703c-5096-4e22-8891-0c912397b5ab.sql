CREATE OR REPLACE FUNCTION public.is_system_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _user_id AND ur.role = 'system_admin'::public.app_role
  )
  OR EXISTS (
    SELECT 1 FROM auth.users u
    WHERE u.id = _user_id AND lower(u.email) LIKE '%@riskclock.com'
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_system_admin(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_system_admin(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "System admins manage roles" ON public.user_roles;
CREATE POLICY "System admins manage roles"
ON public.user_roles
FOR ALL
TO authenticated
USING (public.is_system_admin(auth.uid()))
WITH CHECK (public.is_system_admin(auth.uid()));