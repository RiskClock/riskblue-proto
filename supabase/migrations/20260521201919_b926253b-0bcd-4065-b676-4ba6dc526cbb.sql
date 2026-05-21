ALTER TABLE public.analysis_requests
  ADD COLUMN IF NOT EXISTS pipeline_phase_override text;