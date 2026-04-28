-- Helper: does the calling user own the given company name (case-insensitive)?
CREATE OR REPLACE FUNCTION public.user_owns_company(_company text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND p.is_active = true
      AND coalesce(p.company, '') <> ''
      AND lower(p.company) = lower(coalesce(_company, ''))
  );
$$;

-- Recreate company_logos policies using the helper
DROP POLICY IF EXISTS "Company members can insert their company logo" ON public.company_logos;
DROP POLICY IF EXISTS "Company members can update their company logo" ON public.company_logos;
DROP POLICY IF EXISTS "Company members can delete their company logo" ON public.company_logos;

CREATE POLICY "Company members can insert their company logo"
ON public.company_logos
FOR INSERT
TO authenticated
WITH CHECK (public.is_internal_user(auth.uid()) OR public.user_owns_company(company));

CREATE POLICY "Company members can update their company logo"
ON public.company_logos
FOR UPDATE
TO authenticated
USING (public.is_internal_user(auth.uid()) OR public.user_owns_company(company))
WITH CHECK (public.is_internal_user(auth.uid()) OR public.user_owns_company(company));

CREATE POLICY "Company members can delete their company logo"
ON public.company_logos
FOR DELETE
TO authenticated
USING (public.is_internal_user(auth.uid()) OR public.user_owns_company(company));

-- Also recreate storage policies for company-logos bucket using the helper (no folder match required)
DROP POLICY IF EXISTS "Company members can upload their company logo" ON storage.objects;
DROP POLICY IF EXISTS "Company members can update company logo objects" ON storage.objects;
DROP POLICY IF EXISTS "Company members can delete company logo objects" ON storage.objects;
DROP POLICY IF EXISTS "Public can view company logos" ON storage.objects;

CREATE POLICY "Public can view company logos"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'company-logos');

CREATE POLICY "Company members can upload their company logo"
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
        AND coalesce(p.company, '') <> ''
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
    public.is_internal_user(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.is_active = true
        AND coalesce(p.company, '') <> ''
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
    public.is_internal_user(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.is_active = true
        AND coalesce(p.company, '') <> ''
    )
  )
);