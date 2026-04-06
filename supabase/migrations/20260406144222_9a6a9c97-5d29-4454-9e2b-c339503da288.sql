ALTER TABLE public.awp_class_prompts
  ADD COLUMN triage_drive_file_id text,
  ADD COLUMN triage_drive_file_name text,
  ADD COLUMN triage_drive_file_url text,
  ADD COLUMN triage_drive_file_modified_at timestamptz,
  ADD COLUMN triage_is_stale boolean NOT NULL DEFAULT false,
  ADD COLUMN triage_prompt_content text,
  ADD COLUMN triage_content_updated_at timestamptz;