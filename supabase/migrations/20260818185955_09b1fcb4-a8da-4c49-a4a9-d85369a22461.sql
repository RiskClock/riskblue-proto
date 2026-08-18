DROP POLICY IF EXISTS "Project members can upload analysis files" ON storage.objects;

CREATE POLICY "Project members can upload analysis files"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'drive-analysis-files' AND
  (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id::text = (storage.foldername(objects.name))[1]
        AND (projects.user_id = auth.uid() OR is_project_member(auth.uid(), projects.id))
    )
    OR is_internal_user(auth.uid())
  )
);