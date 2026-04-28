
-- =========================
-- Table: company_logos
-- =========================
DROP POLICY IF EXISTS "WMSV users can delete their company logo" ON public.company_logos;
DROP POLICY IF EXISTS "WMSV users can update their company logo" ON public.company_logos;
DROP POLICY IF EXISTS "WMSV users can upsert their company logo" ON public.company_logos;

CREATE POLICY "Company members can insert their company logo"
ON public.company_logos
FOR INSERT
TO authenticated
WITH CHECK (
  is_internal_user(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND p.is_active = true
      AND COALESCE(p.company, '') <> ''
      AND lower(p.company) = lower(company_logos.company)
  )
);

CREATE POLICY "Company members can update their company logo"
ON public.company_logos
FOR UPDATE
TO authenticated
USING (
  is_internal_user(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND p.is_active = true
      AND lower(COALESCE(p.company, '')) = lower(company_logos.company)
  )
)
WITH CHECK (
  is_internal_user(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND p.is_active = true
      AND lower(COALESCE(p.company, '')) = lower(company_logos.company)
  )
);

CREATE POLICY "Company members can delete their company logo"
ON public.company_logos
FOR DELETE
TO authenticated
USING (
  is_internal_user(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND p.is_active = true
      AND lower(COALESCE(p.company, '')) = lower(company_logos.company)
  )
);

-- =========================
-- Storage: company-logos bucket
-- =========================
DROP POLICY IF EXISTS "WMSV can upload their company logo" ON storage.objects;
DROP POLICY IF EXISTS "WMSV can update company logo objects" ON storage.objects;
DROP POLICY IF EXISTS "WMSV can delete company logo objects" ON storage.objects;

CREATE POLICY "Company members can upload their company logo"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'company-logos'
  AND (
    is_internal_user(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.is_active = true
        AND COALESCE(p.company, '') <> ''
    )
  )
);

CREATE POLICY "Company members can update company logo objects"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'company-logos'
  AND (
    is_internal_user(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.is_active = true
        AND COALESCE(p.company, '') <> ''
    )
  )
);

CREATE POLICY "Company members can delete company logo objects"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'company-logos'
  AND (
    is_internal_user(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.is_active = true
        AND COALESCE(p.company, '') <> ''
    )
  )
);
