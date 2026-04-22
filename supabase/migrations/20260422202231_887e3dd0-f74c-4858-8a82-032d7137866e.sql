-- =========================================
-- Cleanup ALL uploaded-drawings policies and recreate correctly
-- The previous policies referenced p.name / projects.name (the project title column)
-- inside storage.foldername() instead of the storage object's own name column.
-- This made every upload fail RLS.
-- =========================================

DROP POLICY IF EXISTS "Internal users can manage uploaded drawings" ON storage.objects;
DROP POLICY IF EXISTS "Project members can delete manual drawings" ON storage.objects;
DROP POLICY IF EXISTS "Project members can update manual drawings" ON storage.objects;
DROP POLICY IF EXISTS "Project members can upload manual drawings" ON storage.objects;
DROP POLICY IF EXISTS "Project members can view manual drawings" ON storage.objects;
DROP POLICY IF EXISTS "Project owners can delete drawings" ON storage.objects;
DROP POLICY IF EXISTS "Project owners can upload drawings" ON storage.objects;
DROP POLICY IF EXISTS "Project owners can view drawings" ON storage.objects;

-- Single authoritative INSERT policy: explicitly use storage.objects.name
CREATE POLICY "uploaded_drawings_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'uploaded-drawings'
  AND (
    is_internal_user(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE (p.id)::text = (storage.foldername(storage.objects.name))[1]
        AND (p.user_id = auth.uid() OR public.is_project_member(auth.uid(), p.id))
    )
  )
);

CREATE POLICY "uploaded_drawings_select"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'uploaded-drawings'
  AND (
    is_internal_user(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE (p.id)::text = (storage.foldername(storage.objects.name))[1]
        AND (p.user_id = auth.uid() OR public.is_project_member(auth.uid(), p.id))
    )
  )
);

CREATE POLICY "uploaded_drawings_update"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'uploaded-drawings'
  AND (
    is_internal_user(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE (p.id)::text = (storage.foldername(storage.objects.name))[1]
        AND (p.user_id = auth.uid() OR public.is_project_member(auth.uid(), p.id))
    )
  )
)
WITH CHECK (
  bucket_id = 'uploaded-drawings'
  AND (
    is_internal_user(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE (p.id)::text = (storage.foldername(storage.objects.name))[1]
        AND (p.user_id = auth.uid() OR public.is_project_member(auth.uid(), p.id))
    )
  )
);

CREATE POLICY "uploaded_drawings_delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'uploaded-drawings'
  AND (
    is_internal_user(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE (p.id)::text = (storage.foldername(storage.objects.name))[1]
        AND (p.user_id = auth.uid() OR public.is_project_member(auth.uid(), p.id))
    )
  )
);

-- =========================================
-- Align analysis_requests SELECT for project members (currently owner/internal only)
-- =========================================
DROP POLICY IF EXISTS "Users can view analysis requests for their projects" ON public.analysis_requests;

CREATE POLICY "Users can view analysis requests for their projects"
ON public.analysis_requests FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = analysis_requests.project_id
      AND (p.user_id = auth.uid() OR public.is_project_member(auth.uid(), p.id))
  )
  OR is_internal_user(auth.uid())
);

-- =========================================
-- Add project-member UPDATE policy for analysis_request_files
-- Needed so background upload can flip copy_status from pending -> copied/failed
-- =========================================
CREATE POLICY "Project members can update analysis request files"
ON public.analysis_request_files FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.analysis_requests ar
    JOIN public.projects p ON p.id = ar.project_id
    WHERE ar.id = analysis_request_files.analysis_request_id
      AND (p.user_id = auth.uid() OR public.is_project_member(auth.uid(), p.id))
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.analysis_requests ar
    JOIN public.projects p ON p.id = ar.project_id
    WHERE ar.id = analysis_request_files.analysis_request_id
      AND (p.user_id = auth.uid() OR public.is_project_member(auth.uid(), p.id))
  )
);

-- Allow project owner/members to delete failed placeholder rows
CREATE POLICY "Project members can delete analysis request files"
ON public.analysis_request_files FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.analysis_requests ar
    JOIN public.projects p ON p.id = ar.project_id
    WHERE ar.id = analysis_request_files.analysis_request_id
      AND (p.user_id = auth.uid() OR public.is_project_member(auth.uid(), p.id))
  )
);
