ALTER TABLE public.analysis_request_sheets
ADD COLUMN IF NOT EXISTS floor_plan_overrides JSONB NOT NULL DEFAULT '{}'::jsonb;