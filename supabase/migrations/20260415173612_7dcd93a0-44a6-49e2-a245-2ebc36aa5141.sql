
DROP POLICY IF EXISTS "Project members and internal users can view analysis files" ON storage.objects;

CREATE POLICY "Project members and internal users can view analysis files"
ON storage.objects FOR SELECT TO public
USING (
  bucket_id = 'drive-analysis-files'
  AND (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id::text = (storage.foldername(objects.name))[1]
        AND (projects.user_id = auth.uid() OR is_project_member(auth.uid(), projects.id))
    )
    OR is_internal_user(auth.uid())
  )
);
