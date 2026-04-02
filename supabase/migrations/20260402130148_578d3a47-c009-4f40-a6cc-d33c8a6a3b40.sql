ALTER TABLE public.analysis_requests
  ADD COLUMN IF NOT EXISTS triage_tokens_used integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS triage_model text DEFAULT 'gpt-5-nano',
  ADD COLUMN IF NOT EXISTS analyze_model text DEFAULT 'gpt-5-mini';