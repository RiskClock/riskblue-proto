ALTER TABLE public.analysis_requests
  ADD COLUMN IF NOT EXISTS space_hierarchy_json jsonb,
  ADD COLUMN IF NOT EXISTS space_hierarchy_status text,
  ADD COLUMN IF NOT EXISTS space_hierarchy_error text,
  ADD COLUMN IF NOT EXISTS space_hierarchy_updated_at timestamptz;