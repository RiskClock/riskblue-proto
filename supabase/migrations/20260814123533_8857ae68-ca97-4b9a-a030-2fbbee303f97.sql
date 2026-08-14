ALTER TABLE public.refinery_prompts ADD COLUMN IF NOT EXISTS name text, ADD COLUMN IF NOT EXISTS description text;
UPDATE public.refinery_prompts SET name = COALESCE(name, prompt_key);