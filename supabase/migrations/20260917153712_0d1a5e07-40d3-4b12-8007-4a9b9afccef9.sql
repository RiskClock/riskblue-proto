ALTER TABLE public.tenant_products
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS installation_cost numeric,
  ADD COLUMN IF NOT EXISTS maint_interval text NOT NULL DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS applied_in_any_plan boolean NOT NULL DEFAULT false;

ALTER TABLE public.tenant_products
  ADD CONSTRAINT tenant_products_maint_interval_check
  CHECK (maint_interval IN ('monthly','yearly'));