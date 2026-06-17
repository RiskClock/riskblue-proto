ALTER TABLE public.analysis_request_files
  ADD COLUMN IF NOT EXISTS risk_element_results jsonb NOT NULL DEFAULT '{}'::jsonb;