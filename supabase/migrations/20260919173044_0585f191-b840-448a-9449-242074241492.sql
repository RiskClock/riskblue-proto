ALTER TABLE public.project_mitigation_plans
ADD COLUMN product_assignments jsonb NOT NULL DEFAULT '{}'::jsonb;