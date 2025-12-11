-- Add drive_folder_id column to projects table for per-project folder persistence
ALTER TABLE public.projects ADD COLUMN drive_folder_id text;