
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS credits_consumed integer,
  ADD COLUMN IF NOT EXISTS report_file_path text,
  ADD COLUMN IF NOT EXISTS report_file_name text;

UPDATE public.projects SET credits_consumed = 100 WHERE name ILIKE '%55-75 brownlow%phase one%';
UPDATE public.projects SET credits_consumed = 50  WHERE name ILIKE '%pine mount%apartment%';
