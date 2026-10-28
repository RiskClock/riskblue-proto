ALTER TABLE public.external_auth_states DROP CONSTRAINT external_auth_states_mode_check;
ALTER TABLE public.external_auth_states ADD CONSTRAINT external_auth_states_mode_check CHECK (mode = ANY (ARRAY['login'::text, 'link'::text, 'files'::text]));
ALTER TABLE public.external_auth_states ADD COLUMN IF NOT EXISTS return_path text;