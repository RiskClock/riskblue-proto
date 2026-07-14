ALTER TABLE public.analysis_request_files
ADD COLUMN IF NOT EXISTS page_rotations jsonb NOT NULL DEFAULT '{}'::jsonb;