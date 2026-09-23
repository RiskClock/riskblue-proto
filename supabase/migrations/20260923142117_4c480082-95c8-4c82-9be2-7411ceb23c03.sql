ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS beta_enabled boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.tenant_beta_enabled(_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT t.beta_enabled FROM public.tenants t WHERE t.id = _tenant_id), false);
$function$;

DROP FUNCTION IF EXISTS public.get_my_tenants();
CREATE FUNCTION public.get_my_tenants()
 RETURNS TABLE(id uuid, name text, slug text, credits_balance integer, role tenant_role, permissions jsonb, is_member boolean, default_currency text, beta_enabled boolean)
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
    t.default_currency,
    t.beta_enabled
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
    t.default_currency,
    t.beta_enabled
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
 RETURNS TABLE(id uuid, name text, slug text, credits_balance integer, is_active boolean, created_at timestamp with time zone, member_count integer, project_count integer, default_currency text, beta_enabled boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    t.id, t.name, t.slug, t.credits_balance, t.is_active, t.created_at,
    (SELECT count(*)::int FROM public.tenant_members tm WHERE tm.tenant_id = t.id AND tm.status = 'active'),
    (SELECT count(*)::int FROM public.projects p WHERE p.tenant_id = t.id),
    t.default_currency,
    t.beta_enabled
  FROM public.tenants t
  WHERE public.is_internal_user(auth.uid())
  ORDER BY t.name ASC;
$function$;

-- Beta companies get full access to the product catalog
DROP POLICY IF EXISTS "System admins can create tenant products" ON public.tenant_products;
DROP POLICY IF EXISTS "System admins can update tenant products" ON public.tenant_products;
DROP POLICY IF EXISTS "System admins can delete tenant products" ON public.tenant_products;

CREATE POLICY "Beta members and admins can create tenant products"
ON public.tenant_products FOR INSERT TO authenticated
WITH CHECK (
  public.is_system_admin(auth.uid())
  OR (public.is_tenant_member(auth.uid(), tenant_id) AND public.tenant_beta_enabled(tenant_id))
);

CREATE POLICY "Beta members and admins can update tenant products"
ON public.tenant_products FOR UPDATE TO authenticated
USING (
  public.is_system_admin(auth.uid())
  OR (public.is_tenant_member(auth.uid(), tenant_id) AND public.tenant_beta_enabled(tenant_id))
)
WITH CHECK (
  public.is_system_admin(auth.uid())
  OR (public.is_tenant_member(auth.uid(), tenant_id) AND public.tenant_beta_enabled(tenant_id))
);

CREATE POLICY "Beta members and admins can delete tenant products"
ON public.tenant_products FOR DELETE TO authenticated
USING (
  public.is_system_admin(auth.uid())
  OR (public.is_tenant_member(auth.uid(), tenant_id) AND public.tenant_beta_enabled(tenant_id))
);

-- Beta companies get full access to plan builder plans
DROP POLICY IF EXISTS "System admins can manage mitigation plans" ON public.project_mitigation_plans;

CREATE POLICY "Beta editors can manage mitigation plans"
ON public.project_mitigation_plans FOR ALL TO authenticated
USING (
  public.is_system_admin(auth.uid())
  OR (
    public.can_edit_project(auth.uid(), project_id)
    AND public.tenant_beta_enabled((SELECT p.tenant_id FROM public.projects p WHERE p.id = project_id))
  )
)
WITH CHECK (
  public.is_system_admin(auth.uid())
  OR (
    public.can_edit_project(auth.uid(), project_id)
    AND public.tenant_beta_enabled((SELECT p.tenant_id FROM public.projects p WHERE p.id = project_id))
  )
);