DROP FUNCTION IF EXISTS public.get_my_tenants();

CREATE OR REPLACE FUNCTION public.get_my_tenants()
 RETURNS TABLE(id uuid, name text, slug text, credits_balance integer, role tenant_role, permissions jsonb, is_member boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    t.id,
    t.name,
    t.slug,
    t.credits_balance,
    COALESCE(tm.role, 'admin'::public.tenant_role) AS role,
    public.tenant_role_permissions('admin'::public.tenant_role) AS permissions,
    (tm.user_id IS NOT NULL) AS is_member
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
    public.tenant_role_permissions(tm.role) || COALESCE(tm.permission_overrides, '{}'::jsonb),
    true
  FROM public.tenant_members tm
  JOIN public.tenants t ON t.id = tm.tenant_id
  WHERE NOT public.is_internal_user(auth.uid())
    AND tm.user_id = auth.uid()
    AND tm.status = 'active'
    AND t.is_active = true

  ORDER BY 2 ASC;
$function$;