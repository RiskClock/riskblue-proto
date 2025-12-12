-- Add new columns to mitigation_controls table for cost breakdown
ALTER TABLE public.mitigation_controls
ADD COLUMN IF NOT EXISTS application_component text,
ADD COLUMN IF NOT EXISTS one_time_cost numeric,
ADD COLUMN IF NOT EXISTS concept_hours numeric,
ADD COLUMN IF NOT EXISTS hourly_rate numeric,
ADD COLUMN IF NOT EXISTS monthly_maint_hours numeric,
ADD COLUMN IF NOT EXISTS monthly_maint_cost numeric;