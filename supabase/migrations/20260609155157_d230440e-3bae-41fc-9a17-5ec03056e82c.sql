ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS estimated_units integer,
  ADD COLUMN IF NOT EXISTS selected_awp_class_names text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS selected_other_classes text[] NOT NULL DEFAULT '{}'::text[];