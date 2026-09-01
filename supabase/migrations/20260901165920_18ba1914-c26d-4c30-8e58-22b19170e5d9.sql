CREATE OR REPLACE FUNCTION public.is_tenant_scoped_user(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenant_members tm
    JOIN public.tenants t ON t.id = tm.tenant_id
    WHERE tm.user_id = _user_id
      AND COALESCE(tm.status, 'active') = 'active'
      AND t.is_active = true
  )
$$;

GRANT EXECUTE ON FUNCTION public.is_tenant_scoped_user(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Users can view projects they have access to" ON public.projects;
CREATE POLICY "Users can view projects they have access to"
ON public.projects
FOR SELECT
USING (
  is_internal_user(auth.uid())
  OR auth.uid() = user_id
  OR (
    has_project_access(id)
    AND (
      NOT is_tenant_scoped_user(auth.uid())
      OR (tenant_id IS NOT NULL AND is_tenant_member(auth.uid(), tenant_id))
    )
  )
);

DROP POLICY IF EXISTS "Users can update projects they have access to" ON public.projects;
CREATE POLICY "Users can update projects they have access to"
ON public.projects
FOR UPDATE
USING (
  is_internal_user(auth.uid())
  OR auth.uid() = user_id
  OR (
    has_project_access(id)
    AND (
      NOT is_tenant_scoped_user(auth.uid())
      OR (tenant_id IS NOT NULL AND is_tenant_member(auth.uid(), tenant_id))
    )
  )
);