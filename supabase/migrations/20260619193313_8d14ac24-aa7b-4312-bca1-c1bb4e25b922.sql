-- =========================================================
-- 1. annotation_consolidations: scope policies through project membership
-- =========================================================
DROP POLICY IF EXISTS "Authenticated can view consolidations for accessible requests" ON public.annotation_consolidations;
DROP POLICY IF EXISTS "Authenticated can insert consolidations for accessible requests" ON public.annotation_consolidations;
DROP POLICY IF EXISTS "Authenticated can update consolidations for accessible requests" ON public.annotation_consolidations;
DROP POLICY IF EXISTS "Authenticated can delete consolidations for accessible requests" ON public.annotation_consolidations;

CREATE POLICY "Project members can view consolidations"
ON public.annotation_consolidations
FOR SELECT
TO authenticated
USING (
  public.is_internal_user(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.analysis_requests ar
    WHERE ar.id = annotation_consolidations.analysis_request_id
      AND (
        ar.user_id = auth.uid()
        OR (ar.project_id IS NOT NULL AND public.has_project_access(ar.project_id))
      )
  )
);

CREATE POLICY "Project members can insert consolidations"
ON public.annotation_consolidations
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_internal_user(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.analysis_requests ar
    WHERE ar.id = annotation_consolidations.analysis_request_id
      AND (
        ar.user_id = auth.uid()
        OR (ar.project_id IS NOT NULL AND public.has_project_access(ar.project_id))
      )
  )
);

CREATE POLICY "Project members can update consolidations"
ON public.annotation_consolidations
FOR UPDATE
TO authenticated
USING (
  public.is_internal_user(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.analysis_requests ar
    WHERE ar.id = annotation_consolidations.analysis_request_id
      AND (
        ar.user_id = auth.uid()
        OR (ar.project_id IS NOT NULL AND public.has_project_access(ar.project_id))
      )
  )
)
WITH CHECK (
  public.is_internal_user(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.analysis_requests ar
    WHERE ar.id = annotation_consolidations.analysis_request_id
      AND (
        ar.user_id = auth.uid()
        OR (ar.project_id IS NOT NULL AND public.has_project_access(ar.project_id))
      )
  )
);

CREATE POLICY "Project members can delete consolidations"
ON public.annotation_consolidations
FOR DELETE
TO authenticated
USING (
  public.is_internal_user(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.analysis_requests ar
    WHERE ar.id = annotation_consolidations.analysis_request_id
      AND (
        ar.user_id = auth.uid()
        OR (ar.project_id IS NOT NULL AND public.has_project_access(ar.project_id))
      )
  )
);

-- =========================================================
-- 2. company_contacts: tighten SELECT to internal + same-company WMSV
-- =========================================================
DROP POLICY IF EXISTS "Authenticated can view company contacts" ON public.company_contacts;

CREATE POLICY "Internal and same-company WMSV can view contacts"
ON public.company_contacts
FOR SELECT
TO authenticated
USING (
  public.is_internal_user(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND p.account_type = 'wmsv'
      AND p.is_active = true
      AND lower(COALESCE(p.company, '')) = lower(company_contacts.company)
  )
);

-- =========================================================
-- 3. is_internal_user: actually honor its _user_id argument
-- =========================================================
CREATE OR REPLACE FUNCTION public.is_internal_user(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT email FROM auth.users WHERE id = _user_id) ILIKE '%@riskclock.com',
    false
  );
$$;