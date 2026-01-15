-- Make awp-drawings bucket private
UPDATE storage.buckets SET public = false WHERE id = 'awp-drawings';

-- Drop overly permissive policies
DROP POLICY IF EXISTS "Authenticated users can upload drawings" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update drawings" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete drawings" ON storage.objects;
DROP POLICY IF EXISTS "Public can view drawings" ON storage.objects;

-- Only allow viewing drawings for projects user has access to
CREATE POLICY "Users can view drawings for their projects"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'awp-drawings' AND
  (
    (storage.foldername(name))[1] IN (
      SELECT id::text FROM projects WHERE user_id = auth.uid()
      UNION
      SELECT project_id::text FROM project_user_roles WHERE user_id = auth.uid()
    ) 
    OR is_internal_user(auth.uid())
  )
);

-- Restrict uploads to project members and internal users
CREATE POLICY "Project members can upload drawings"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'awp-drawings' AND
  (
    (storage.foldername(name))[1] IN (
      SELECT id::text FROM projects WHERE user_id = auth.uid()
      UNION
      SELECT project_id::text FROM project_user_roles WHERE user_id = auth.uid()
    ) 
    OR is_internal_user(auth.uid())
  )
);

-- Restrict updates to project members
CREATE POLICY "Project members can update drawings"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'awp-drawings' AND
  (
    (storage.foldername(name))[1] IN (
      SELECT id::text FROM projects WHERE user_id = auth.uid()
      UNION
      SELECT project_id::text FROM project_user_roles WHERE user_id = auth.uid()
    ) 
    OR is_internal_user(auth.uid())
  )
);

-- Restrict deletes to project members
CREATE POLICY "Project members can delete drawings"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'awp-drawings' AND
  (
    (storage.foldername(name))[1] IN (
      SELECT id::text FROM projects WHERE user_id = auth.uid()
      UNION
      SELECT project_id::text FROM project_user_roles WHERE user_id = auth.uid()
    ) 
    OR is_internal_user(auth.uid())
  )
);