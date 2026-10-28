CREATE TABLE public.external_link_confirmations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 token_hash text NOT NULL UNIQUE,
 user_id uuid NOT NULL,
 provider text NOT NULL CHECK (provider = 'procore'),
 provider_user_id text NOT NULL,
 email text NOT NULL,
 app_origin text NOT NULL,
 encrypted_access_token text NOT NULL,
 encrypted_refresh_token text,
 token_expiry timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes')
);
GRANT ALL ON public.external_link_confirmations TO service_role;
ALTER TABLE public.external_link_confirmations ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.external_link_confirmations IS 'Server-only pending Procore links; hashed confirmation tokens and encrypted provider tokens, consumed only by the intended authenticated account.';