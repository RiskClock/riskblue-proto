CREATE TABLE public.tenant_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  product_code text,
  control_id uuid REFERENCES public.mitigation_controls(id) ON DELETE SET NULL,
  image_path text,
  one_time_cost numeric,
  monthly_maint_cost numeric,
  scope_customized boolean NOT NULL DEFAULT false,
  critical_asset_ids uuid[] NOT NULL DEFAULT '{}',
  water_system_ids uuid[] NOT NULL DEFAULT '{}',
  process_ids uuid[] NOT NULL DEFAULT '{}',
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_products TO authenticated;
GRANT ALL ON public.tenant_products TO service_role;

ALTER TABLE public.tenant_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view products"
ON public.tenant_products FOR SELECT TO authenticated
USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_system_admin(auth.uid()));

CREATE POLICY "Tenant managers can insert products"
ON public.tenant_products FOR INSERT TO authenticated
WITH CHECK (public.can_manage_tenant_controls(auth.uid(), tenant_id));

CREATE POLICY "Tenant managers can update products"
ON public.tenant_products FOR UPDATE TO authenticated
USING (public.can_manage_tenant_controls(auth.uid(), tenant_id))
WITH CHECK (public.can_manage_tenant_controls(auth.uid(), tenant_id));

CREATE POLICY "Tenant managers can delete products"
ON public.tenant_products FOR DELETE TO authenticated
USING (public.can_manage_tenant_controls(auth.uid(), tenant_id));

CREATE TRIGGER tenant_products_updated_at
BEFORE UPDATE ON public.tenant_products
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_tenant_products_tenant ON public.tenant_products(tenant_id);

CREATE POLICY "Signed-in users can read product images"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'product-images');

CREATE POLICY "Signed-in users can upload product images"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'product-images');

CREATE POLICY "Signed-in users can update product images"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'product-images');

CREATE POLICY "Signed-in users can delete product images"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'product-images');