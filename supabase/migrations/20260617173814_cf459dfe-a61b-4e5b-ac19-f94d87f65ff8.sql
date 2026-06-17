ALTER TABLE public.analysis_request_files
  ADD COLUMN IF NOT EXISTS gemini_cache_id text,
  ADD COLUMN IF NOT EXISTS gemini_cache_expires_at timestamptz;