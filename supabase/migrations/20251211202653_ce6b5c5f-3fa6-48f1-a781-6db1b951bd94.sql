-- Add filesearch_store_id column to projects table
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS filesearch_store_id TEXT;

-- Add comment for documentation
COMMENT ON COLUMN public.projects.filesearch_store_id IS 'Unique Gemini File Search Store ID per project';