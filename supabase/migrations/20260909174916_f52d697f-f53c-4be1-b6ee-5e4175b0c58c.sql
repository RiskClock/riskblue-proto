ALTER TABLE public.company_control_selections
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;

UPDATE public.company_control_selections ccs
SET tenant_id = t.id
FROM public.tenants t
WHERE ccs.tenant_id IS NULL
  AND lower(trim(t.name)) = lower(trim(coalesce(ccs.company, '')));

CREATE UNIQUE INDEX IF NOT EXISTS company_control_selections_tenant_control_uidx
  ON public.company_control_selections (tenant_id, category, control_id)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS company_control_selections_tenant_idx
  ON public.company_control_selections (tenant_id);

CREATE OR REPLACE FUNCTION public.can_manage_tenant_controls(_user_id uuid, _tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _tenant_id IS NOT NULL AND (
    public.is_internal_user(_user_id)
    OR (
      public.is_tenant_member(_user_id, _tenant_id)
      AND public.tenant_member_role(_user_id, _tenant_id) IN ('admin','member')
    )
  );
$$;

DROP POLICY IF EXISTS "Tenant members manage their control selections" ON public.company_control_selections;
CREATE POLICY "Tenant members manage their control selections"
ON public.company_control_selections
FOR ALL
TO authenticated
USING (public.can_manage_tenant_controls(auth.uid(), tenant_id))
WITH CHECK (public.can_manage_tenant_controls(auth.uid(), tenant_id));

CREATE OR REPLACE FUNCTION public.get_control_vendor_offerings()
RETURNS TABLE(control_id uuid, company text, sub_options jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ccs.control_id,
         COALESCE(t.name, ccs.company) AS company,
         ccs.sub_options
  FROM public.company_control_selections ccs
  LEFT JOIN public.tenants t ON t.id = ccs.tenant_id AND t.is_active = true
  WHERE (ccs.tenant_id IS NOT NULL AND t.id IS NOT NULL)
     OR (
       ccs.tenant_id IS NULL
       AND EXISTS (
         SELECT 1 FROM public.profiles p
         WHERE p.account_type = 'wmsv'
           AND p.is_active = true
           AND lower(coalesce(p.company, '')) = lower(ccs.company)
       )
     );
$$;