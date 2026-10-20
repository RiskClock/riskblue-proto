DROP POLICY IF EXISTS "Authenticated can view company control selections" ON public.company_control_selections;

CREATE POLICY "Tenant members can view company control selections"
ON public.company_control_selections
FOR SELECT
TO authenticated
USING (
  public.is_system_admin(auth.uid())
  OR public.is_tenant_member(auth.uid(), tenant_id)
  OR (
    tenant_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND COALESCE(p.company, '') <> ''
        AND lower(p.company) = lower(company_control_selections.company)
    )
  )
);