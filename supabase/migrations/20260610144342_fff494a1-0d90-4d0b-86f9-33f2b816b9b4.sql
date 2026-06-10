
CREATE POLICY "project-reports read for members"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'project-reports'
  AND (
    public.is_internal_user(auth.uid())
    OR public.has_project_access( (string_to_array(name, '/'))[1]::uuid )
  )
);

CREATE POLICY "project-reports insert for members"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'project-reports'
  AND (
    public.is_internal_user(auth.uid())
    OR public.has_project_access( (string_to_array(name, '/'))[1]::uuid )
  )
);

CREATE POLICY "project-reports update for members"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'project-reports'
  AND (
    public.is_internal_user(auth.uid())
    OR public.has_project_access( (string_to_array(name, '/'))[1]::uuid )
  )
);

CREATE POLICY "project-reports delete for members"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'project-reports'
  AND (
    public.is_internal_user(auth.uid())
    OR public.has_project_access( (string_to_array(name, '/'))[1]::uuid )
  )
);
