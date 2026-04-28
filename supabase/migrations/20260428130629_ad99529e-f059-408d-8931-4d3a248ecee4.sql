-- Tighten company_logos and storage policies to wmsv + matching company
DROP POLICY IF EXISTS "Company members can insert their company logo" ON public.company_logos;
DROP POLICY IF EXISTS "Company members can update their company logo" ON public.company_logos;
DROP POLICY IF EXISTS "Company members can delete their company logo" ON public.company_logos;

CREATE POLICY "WMSV company members can insert their company logo"
ON public.company_logos
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_internal_user(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND p.is_active = true
      AND p.account_type = 'wmsv'
      AND coalesce(p.company, '') <> ''
      AND lower(p.company) = lower(company_logos.company)
  )
);

CREATE POLICY "WMSV company members can update their company logo"
ON public.company_logos
FOR UPDATE
TO authenticated
USING (
  public.is_internal_user(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND p.is_active = true
      AND p.account_type = 'wmsv'
      AND lower(coalesce(p.company, '')) = lower(company_logos.company)
  )
)
WITH CHECK (
  public.is_internal_user(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND p.is_active = true
      AND p.account_type = 'wmsv'
      AND lower(coalesce(p.company, '')) = lower(company_logos.company)
  )
);

CREATE POLICY "WMSV company members can delete their company logo"
ON public.company_logos
FOR DELETE
TO authenticated
USING (
  public.is_internal_user(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND p.is_active = true
      AND p.account_type = 'wmsv'
      AND lower(coalesce(p.company, '')) = lower(company_logos.company)
  )
);

-- Storage bucket: allow wmsv users with a non-empty company (path-agnostic; folder slug differs from company name)
DROP POLICY IF EXISTS "Company members can upload their company logo" ON storage.objects;
DROP POLICY IF EXISTS "Company members can update company logo objects" ON storage.objects;
DROP POLICY IF EXISTS "Company members can delete company logo objects" ON storage.objects;

CREATE POLICY "WMSV users can upload company logo objects"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'company-logos'
  AND (
    public.is_internal_user(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.is_active = true
        AND p.account_type = 'wmsv'
        AND coalesce(p.company, '') <> ''
    )
  )
);

CREATE POLICY "WMSV users can update company logo objects"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'company-logos'
  AND (
    public.is_internal_user(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.is_active = true
        AND p.account_type = 'wmsv'
        AND coalesce(p.company, '') <> ''
    )
  )
);

CREATE POLICY "WMSV users can delete company logo objects"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'company-logos'
  AND (
    public.is_internal_user(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.is_active = true
        AND p.account_type = 'wmsv'
        AND coalesce(p.company, '') <> ''
    )
  )
);