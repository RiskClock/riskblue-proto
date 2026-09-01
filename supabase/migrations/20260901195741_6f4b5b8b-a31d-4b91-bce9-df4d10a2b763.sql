-- Internal users get full access to every active tenant

CREATE OR REPLACE FUNCTION public.is_tenant_member(_user_id uuid, _tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_internal_user(_user_id)
     AND EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = _tenant_id AND t.is_active = true)
  OR EXISTS (
    SELECT 1
    FROM public.tenant_members tm
    JOIN public.tenants t ON t.id = tm.tenant_id
    WHERE tm.user_id = _user_id
      AND tm.tenant_id = _tenant_id
      AND tm.status = 'active'
      AND t.is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.tenant_member_role(_user_id uuid, _tenant_id uuid)
RETURNS public.tenant_role
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT tm.role
     FROM public.tenant_members tm
     JOIN public.tenants t ON t.id = tm.tenant_id
     WHERE tm.user_id = _user_id
       AND tm.tenant_id = _tenant_id
       AND tm.status = 'active'
       AND t.is_active = true
     LIMIT 1),
    CASE WHEN public.is_internal_user(_user_id)
          AND EXISTS (SELECT 1 FROM public.tenants t2 WHERE t2.id = _tenant_id AND t2.is_active = true)
         THEN 'admin'::public.tenant_role END
  );
$$;

CREATE OR REPLACE FUNCTION public.tenant_has_permission(_user_id uuid, _tenant_id uuid, _flag text)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role public.tenant_role;
  v_overrides jsonb;
BEGIN
  IF public.is_internal_user(_user_id)
     AND EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = _tenant_id AND t.is_active = true) THEN
    RETURN true;
  END IF;

  SELECT tm.role, tm.permission_overrides
    INTO v_role, v_overrides
  FROM public.tenant_members tm
  JOIN public.tenants t ON t.id = tm.tenant_id
  WHERE tm.user_id = _user_id
    AND tm.tenant_id = _tenant_id
    AND tm.status = 'active'
    AND t.is_active = true
  LIMIT 1;

  IF v_role IS NULL THEN
    RETURN false;
  END IF;

  RETURN COALESCE(
    (public.tenant_role_permissions(v_role) || COALESCE(v_overrides, '{}'::jsonb)) ->> _flag,
    'false'
  )::boolean;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_tenants()
RETURNS TABLE(
  id uuid,
  name text,
  slug text,
  credits_balance integer,
  role public.tenant_role,
  permissions jsonb
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.id,
    t.name,
    t.slug,
    t.credits_balance,
    COALESCE(tm.role, 'admin'::public.tenant_role) AS role,
    public.tenant_role_permissions('admin'::public.tenant_role) AS permissions
  FROM public.tenants t
  LEFT JOIN public.tenant_members tm
    ON tm.tenant_id = t.id AND tm.user_id = auth.uid() AND tm.status = 'active'
  WHERE public.is_internal_user(auth.uid())
    AND t.is_active = true

  UNION ALL

  SELECT
    t.id,
    t.name,
    t.slug,
    CASE WHEN public.tenant_has_permission(auth.uid(), t.id, 'view_credits')
         THEN t.credits_balance ELSE NULL END,
    tm.role,
    public.tenant_role_permissions(tm.role) || COALESCE(tm.permission_overrides, '{}'::jsonb)
  FROM public.tenant_members tm
  JOIN public.tenants t ON t.id = tm.tenant_id
  WHERE NOT public.is_internal_user(auth.uid())
    AND tm.user_id = auth.uid()
    AND tm.status = 'active'
    AND t.is_active = true

  ORDER BY 2 ASC;
$$;

REVOKE ALL ON FUNCTION public.is_tenant_member(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.tenant_member_role(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.tenant_has_permission(uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.get_my_tenants() FROM anon;