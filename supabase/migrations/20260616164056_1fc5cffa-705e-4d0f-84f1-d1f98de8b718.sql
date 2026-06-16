ALTER TABLE public.analysis_request_files
ADD COLUMN IF NOT EXISTS survey_raw_response text,
ADD COLUMN IF NOT EXISTS survey_raw_updated_at timestamptz;