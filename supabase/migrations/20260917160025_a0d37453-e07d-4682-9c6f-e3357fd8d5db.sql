CREATE UNIQUE INDEX IF NOT EXISTS tenant_products_tenant_code_unique
ON public.tenant_products (tenant_id, lower(product_code))
WHERE product_code IS NOT NULL;