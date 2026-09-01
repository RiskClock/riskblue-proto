CREATE OR REPLACE FUNCTION public.is_project_member(_user_id uuid, _project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.project_user_roles
    WHERE user_id = _user_id
      AND project_id = _project_id
  )
  OR EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = _project_id
      AND p.tenant_id IS NOT NULL
      AND public.is_tenant_member(_user_id, p.tenant_id)
  )
$$;

CREATE OR REPLACE FUNCTION public.has_project_access(project_uuid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_project_member(auth.uid(), project_uuid)
$$;

DROP POLICY IF EXISTS "Users can view drawings for their projects" ON storage.objects;
CREATE POLICY "Users can view drawings for their projects"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'awp-drawings'
  AND (
    is_internal_user(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id::text = (storage.foldername(name))[1]
        AND (p.user_id = auth.uid() OR public.is_project_member(auth.uid(), p.id))
    )
  )
);

DROP POLICY IF EXISTS "Project members can update drawings" ON storage.objects;
CREATE POLICY "Project members can update drawings"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'awp-drawings'
  AND (
    is_internal_user(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id::text = (storage.foldername(name))[1]
        AND (p.user_id = auth.uid() OR public.is_project_member(auth.uid(), p.id))
    )
  )
);

DROP POLICY IF EXISTS "Project members can delete drawings" ON storage.objects;
CREATE POLICY "Project members can delete drawings"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'awp-drawings'
  AND (
    is_internal_user(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id::text = (storage.foldername(name))[1]
        AND (p.user_id = auth.uid() OR public.is_project_member(auth.uid(), p.id))
    )
  )
);