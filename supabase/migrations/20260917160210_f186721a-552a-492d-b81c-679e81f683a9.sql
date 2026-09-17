ALTER TABLE public.tenant_products
ADD COLUMN IF NOT EXISTS fixed_quantity integer NOT NULL DEFAULT 1;