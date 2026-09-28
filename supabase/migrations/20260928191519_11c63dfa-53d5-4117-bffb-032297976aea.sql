ALTER TABLE public.projects
ADD COLUMN IF NOT EXISTS risk_device_assignments jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.project_mitigation_plans
ADD COLUMN IF NOT EXISTS color text;

ALTER TABLE public.project_mitigation_plans
ADD COLUMN IF NOT EXISTS included_instance_ids jsonb NOT NULL DEFAULT '[]'::jsonb;