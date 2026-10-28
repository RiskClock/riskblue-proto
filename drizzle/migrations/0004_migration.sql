CREATE TABLE public.user_external_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('autodesk','procore')),
  provider_user_id text NOT NULL,
  email text,
  linked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_user_id),
  UNIQUE (user_id, provider)
);
GRANT SELECT ON public.user_external_identities TO authenticated;
GRANT ALL ON public.user_external_identities TO service_role;
ALTER TABLE public.user_external_identities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own external identities" ON public.user_external_identities
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE TABLE public.external_auth_states (
  state text PRIMARY KEY,
  provider text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('login','link')),
  user_id uuid,
  code_verifier text,
  app_origin text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.external_auth_states TO service_role;
ALTER TABLE public.external_auth_states ENABLE ROW LEVEL SECURITY;