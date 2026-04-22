-- Allow project owners/members to upload to uploaded-drawings (path: {project_id}/{request_id}/{file})
CREATE POLICY "Project members can upload manual drawings"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'uploaded-drawings'
  AND (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE (p.id)::text = (storage.foldername(name))[1]
        AND (p.user_id = auth.uid() OR public.is_project_member(auth.uid(), p.id))
    )
    OR public.is_internal_user(auth.uid())
  )
);

CREATE POLICY "Project members can view manual drawings"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'uploaded-drawings'
  AND (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE (p.id)::text = (storage.foldername(name))[1]
        AND (p.user_id = auth.uid() OR public.is_project_member(auth.uid(), p.id))
    )
    OR public.is_internal_user(auth.uid())
  )
);

CREATE POLICY "Project members can update manual drawings"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'uploaded-drawings'
  AND (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE (p.id)::text = (storage.foldername(name))[1]
        AND (p.user_id = auth.uid() OR public.is_project_member(auth.uid(), p.id))
    )
    OR public.is_internal_user(auth.uid())
  )
);

CREATE POLICY "Project members can delete manual drawings"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'uploaded-drawings'
  AND (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE (p.id)::text = (storage.foldername(name))[1]
        AND (p.user_id = auth.uid() OR public.is_project_member(auth.uid(), p.id))
    )
    OR public.is_internal_user(auth.uid())
  )
);