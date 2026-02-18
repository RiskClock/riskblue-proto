ALTER TABLE public.analysis_request_files
  ADD COLUMN openai_file_id          text,
  ADD COLUMN openai_file_uploaded_at timestamptz,
  ADD COLUMN openai_file_expires_at  timestamptz,
  ADD COLUMN openai_file_status      text;