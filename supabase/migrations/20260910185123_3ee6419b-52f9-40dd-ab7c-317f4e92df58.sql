ALTER TABLE public.project_mitigation_plans
  ADD COLUMN IF NOT EXISTS excluded_instances jsonb NOT NULL DEFAULT '{}'::jsonb;