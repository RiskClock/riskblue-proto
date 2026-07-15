ALTER TABLE public.projects
ADD COLUMN workbench_status text NOT NULL DEFAULT 'processing'
CHECK (workbench_status IN ('processing','processed'));