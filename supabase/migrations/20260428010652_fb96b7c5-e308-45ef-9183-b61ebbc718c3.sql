
-- 1. Company contacts table (name + email, scoped per company)
CREATE TABLE public.company_contacts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  created_by UUID,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_company_contacts_company_lower ON public.company_contacts (lower(company));

ALTER TABLE public.company_contacts ENABLE ROW LEVEL SECURITY;

-- View: any authenticated user can see contacts (parity with company_control_selections)
CREATE POLICY "Authenticated can view company contacts"
ON public.company_contacts
FOR SELECT
TO authenticated
USING (true);

-- Insert: WMSV users from same company OR internal users
CREATE POLICY "WMSV users can insert their company contacts"
ON public.company_contacts
FOR INSERT
TO authenticated
WITH CHECK (
  is_internal_user(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND p.account_type = 'wmsv'
      AND p.is_active = true
      AND lower(coalesce(p.company, '')) = lower(company_contacts.company)
      AND coalesce(p.company, '') <> ''
  )
);

CREATE POLICY "WMSV users can update their company contacts"
ON public.company_contacts
FOR UPDATE
TO authenticated
USING (
  is_internal_user(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND p.account_type = 'wmsv'
      AND p.is_active = true
      AND lower(coalesce(p.company, '')) = lower(company_contacts.company)
  )
);

CREATE POLICY "WMSV users can delete their company contacts"
ON public.company_contacts
FOR DELETE
TO authenticated
USING (
  is_internal_user(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND p.account_type = 'wmsv'
      AND p.is_active = true
      AND lower(coalesce(p.company, '')) = lower(company_contacts.company)
  )
);

CREATE TRIGGER update_company_contacts_updated_at
BEFORE UPDATE ON public.company_contacts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Company logos: store on profiles? No — single logo per company. Use a small table.
CREATE TABLE public.company_logos (
  company TEXT NOT NULL PRIMARY KEY,
  storage_path TEXT NOT NULL,
  updated_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.company_logos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view company logos"
ON public.company_logos
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "WMSV users can upsert their company logo"
ON public.company_logos
FOR INSERT
TO authenticated
WITH CHECK (
  is_internal_user(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND p.account_type = 'wmsv'
      AND p.is_active = true
      AND lower(coalesce(p.company, '')) = lower(company_logos.company)
      AND coalesce(p.company, '') <> ''
  )
);

CREATE POLICY "WMSV users can update their company logo"
ON public.company_logos
FOR UPDATE
TO authenticated
USING (
  is_internal_user(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND p.account_type = 'wmsv'
      AND p.is_active = true
      AND lower(coalesce(p.company, '')) = lower(company_logos.company)
  )
);

CREATE POLICY "WMSV users can delete their company logo"
ON public.company_logos
FOR DELETE
TO authenticated
USING (
  is_internal_user(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND p.account_type = 'wmsv'
      AND p.is_active = true
      AND lower(coalesce(p.company, '')) = lower(company_logos.company)
  )
);

-- 3. Public storage bucket for logos
INSERT INTO storage.buckets (id, name, public)
VALUES ('company-logos', 'company-logos', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: anyone can view (public bucket); WMSV from matching company can write
CREATE POLICY "Public can view company logos"
ON storage.objects
FOR SELECT
USING (bucket_id = 'company-logos');

CREATE POLICY "WMSV can upload their company logo"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'company-logos' AND (
    is_internal_user(auth.uid()) OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_type = 'wmsv'
        AND p.is_active = true
        AND coalesce(p.company, '') <> ''
    )
  )
);

CREATE POLICY "WMSV can update company logo objects"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'company-logos' AND (
    is_internal_user(auth.uid()) OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_type = 'wmsv'
        AND p.is_active = true
        AND coalesce(p.company, '') <> ''
    )
  )
);

CREATE POLICY "WMSV can delete company logo objects"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'company-logos' AND (
    is_internal_user(auth.uid()) OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_type = 'wmsv'
        AND p.is_active = true
        AND coalesce(p.company, '') <> ''
    )
  )
);
