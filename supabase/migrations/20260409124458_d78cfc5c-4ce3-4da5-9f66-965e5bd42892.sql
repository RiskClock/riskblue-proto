ALTER TABLE public.user_procore_tokens 
ADD COLUMN IF NOT EXISTS refreshing_since timestamptz DEFAULT NULL;