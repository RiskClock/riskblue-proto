ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS default_currency text NOT NULL DEFAULT 'USD';

ALTER TABLE public.tenants
  DROP CONSTRAINT IF EXISTS tenants_default_currency_check;

ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_default_currency_check CHECK (default_currency IN ('USD', 'GBP'));

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS currency_code text NOT NULL DEFAULT 'USD';

ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_currency_code_check;

ALTER TABLE public.projects
  ADD CONSTRAINT projects_currency_code_check CHECK (currency_code IN ('USD', 'GBP'));

DROP FUNCTION IF EXISTS public.get_my_tenants();

CREATE FUNCTION public.get_my_tenants()
 RETURNS TABLE(id uuid, name text, slug text, credits_balance integer, role tenant_role, permissions jsonb, is_member boolean, default_currency text)
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
    (tm.user_id IS NOT NULL) AS is_member,
    t.default_currency
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
    true,
    t.default_currency
  FROM public.tenant_members tm
  JOIN public.tenants t ON t.id = tm.tenant_id
  WHERE NOT public.is_internal_user(auth.uid())
    AND tm.user_id = auth.uid()
    AND tm.status = 'active'
    AND t.is_active = true

  ORDER BY 2 ASC;
$function$;

DROP FUNCTION IF EXISTS public.get_tenant_summaries();

CREATE FUNCTION public.get_tenant_summaries()
 RETURNS TABLE(id uuid, name text, slug text, credits_balance integer, is_active boolean, created_at timestamp with time zone, member_count integer, project_count integer, default_currency text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    t.id, t.name, t.slug, t.credits_balance, t.is_active, t.created_at,
    (SELECT count(*)::int FROM public.tenant_members tm WHERE tm.tenant_id = t.id AND tm.status = 'active'),
    (SELECT count(*)::int FROM public.projects p WHERE p.tenant_id = t.id),
    t.default_currency
  FROM public.tenants t
  WHERE public.is_internal_user(auth.uid())
  ORDER BY t.name ASC;
$function$;