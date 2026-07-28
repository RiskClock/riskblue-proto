ALTER TABLE public.company_logos DROP CONSTRAINT IF EXISTS company_logos_pkey;
ALTER TABLE public.company_logos ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.company_logos ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.company_logos ADD COLUMN IF NOT EXISTS is_current boolean NOT NULL DEFAULT true;
ALTER TABLE public.company_logos ADD CONSTRAINT company_logos_pkey PRIMARY KEY (id);
CREATE UNIQUE INDEX IF NOT EXISTS company_logos_company_path_key ON public.company_logos (lower(company), storage_path);
CREATE INDEX IF NOT EXISTS company_logos_company_idx ON public.company_logos (lower(company));

DROP POLICY IF EXISTS "WMSV company members can insert their company logo" ON public.company_logos;
DROP POLICY IF EXISTS "WMSV company members can update their company logo" ON public.company_logos;
DROP POLICY IF EXISTS "WMSV company members can delete their company logo" ON public.company_logos;

CREATE POLICY "Internal users can insert company logos"
ON public.company_logos FOR INSERT TO authenticated
WITH CHECK (public.is_internal_user(auth.uid()));

CREATE POLICY "Internal users can update company logos"
ON public.company_logos FOR UPDATE TO authenticated
USING (public.is_internal_user(auth.uid()))
WITH CHECK (public.is_internal_user(auth.uid()));

CREATE POLICY "Internal users can delete company logos"
ON public.company_logos FOR DELETE TO authenticated
USING (public.is_internal_user(auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_logos TO authenticated;
GRANT ALL ON public.company_logos TO service_role;