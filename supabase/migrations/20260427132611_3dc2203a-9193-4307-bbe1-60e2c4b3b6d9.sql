-- 1. New company-keyed control selections table
CREATE TABLE IF NOT EXISTS public.company_control_selections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company text NOT NULL,
  category text NOT NULL,
  control_id uuid NOT NULL,
  sub_options jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company, category, control_id)
);

CREATE INDEX IF NOT EXISTS idx_company_control_selections_company_lower
  ON public.company_control_selections (lower(company));
CREATE INDEX IF NOT EXISTS idx_company_control_selections_control
  ON public.company_control_selections (control_id);

ALTER TABLE public.company_control_selections ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can view (vendor counts are visible across the app)
CREATE POLICY "Authenticated can view company control selections"
ON public.company_control_selections FOR SELECT
TO authenticated
USING (true);

-- Only WMSV users from the same company (active) or internal users can manage
CREATE POLICY "WMSV users can insert their company selections"
ON public.company_control_selections FOR INSERT
TO authenticated
WITH CHECK (
  is_internal_user(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND p.account_type = 'wmsv'
      AND p.is_active = true
      AND lower(coalesce(p.company, '')) = lower(company_control_selections.company)
      AND coalesce(p.company, '') <> ''
  )
);

CREATE POLICY "WMSV users can update their company selections"
ON public.company_control_selections FOR UPDATE
TO authenticated
USING (
  is_internal_user(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND p.account_type = 'wmsv'
      AND p.is_active = true
      AND lower(coalesce(p.company, '')) = lower(company_control_selections.company)
  )
);

CREATE POLICY "WMSV users can delete their company selections"
ON public.company_control_selections FOR DELETE
TO authenticated
USING (
  is_internal_user(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND p.account_type = 'wmsv'
      AND p.is_active = true
      AND lower(coalesce(p.company, '')) = lower(company_control_selections.company)
  )
);

CREATE TRIGGER trg_company_control_selections_updated_at
BEFORE UPDATE ON public.company_control_selections
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Vendor offerings function: returns control_id, company, sub_options for active companies only
CREATE OR REPLACE FUNCTION public.get_control_vendor_offerings()
RETURNS TABLE (
  control_id uuid,
  company text,
  sub_options jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ccs.control_id, ccs.company, ccs.sub_options
  FROM public.company_control_selections ccs
  WHERE EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.account_type = 'wmsv'
      AND p.is_active = true
      AND lower(coalesce(p.company, '')) = lower(ccs.company)
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_control_vendor_offerings() TO authenticated, anon;

-- 3. Extend access_requests
ALTER TABLE public.access_requests
  ADD COLUMN IF NOT EXISTS request_type text NOT NULL DEFAULT 'signup',
  ADD COLUMN IF NOT EXISTS requesting_user_id uuid;

CREATE INDEX IF NOT EXISTS idx_access_requests_user_type
  ON public.access_requests (requesting_user_id, request_type);
