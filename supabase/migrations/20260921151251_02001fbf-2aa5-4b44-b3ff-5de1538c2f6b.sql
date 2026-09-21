DROP POLICY IF EXISTS "Tenant admins and members can create products" ON public.tenant_products;
DROP POLICY IF EXISTS "Tenant admins and members can update products" ON public.tenant_products;
DROP POLICY IF EXISTS "Tenant admins and members can delete products" ON public.tenant_products;

CREATE POLICY "System admins can create tenant products"
ON public.tenant_products
FOR INSERT
TO authenticated
WITH CHECK (public.is_system_admin(auth.uid()));

CREATE POLICY "System admins can update tenant products"
ON public.tenant_products
FOR UPDATE
TO authenticated
USING (public.is_system_admin(auth.uid()))
WITH CHECK (public.is_system_admin(auth.uid()));

CREATE POLICY "System admins can delete tenant products"
ON public.tenant_products
FOR DELETE
TO authenticated
USING (public.is_system_admin(auth.uid()));

DROP POLICY IF EXISTS "Project editors can manage mitigation plans" ON public.project_mitigation_plans;

CREATE POLICY "System admins can manage mitigation plans"
ON public.project_mitigation_plans
FOR ALL
TO authenticated
USING (public.is_system_admin(auth.uid()))
WITH CHECK (public.is_system_admin(auth.uid()));