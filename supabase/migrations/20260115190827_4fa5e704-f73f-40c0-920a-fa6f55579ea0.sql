-- Create storage bucket for uploaded drawings
INSERT INTO storage.buckets (id, name, public)
VALUES ('uploaded-drawings', 'uploaded-drawings', false);

-- RLS policies for uploaded-drawings bucket
CREATE POLICY "Project owners can upload drawings"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'uploaded-drawings' AND
  EXISTS (
    SELECT 1 FROM projects
    WHERE id::text = (storage.foldername(name))[1]
    AND user_id = auth.uid()
  )
);

CREATE POLICY "Project owners can view drawings"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'uploaded-drawings' AND
  (
    EXISTS (
      SELECT 1 FROM projects
      WHERE id::text = (storage.foldername(name))[1]
      AND user_id = auth.uid()
    )
    OR is_internal_user(auth.uid())
  )
);

CREATE POLICY "Project owners can delete drawings"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'uploaded-drawings' AND
  EXISTS (
    SELECT 1 FROM projects
    WHERE id::text = (storage.foldername(name))[1]
    AND user_id = auth.uid()
  )
);

CREATE POLICY "Internal users can manage uploaded drawings"
ON storage.objects FOR ALL
USING (
  bucket_id = 'uploaded-drawings' AND
  is_internal_user(auth.uid())
);

-- Modify analysis_requests table to support manual uploads
ALTER TABLE analysis_requests 
  ALTER COLUMN drive_folder_id DROP NOT NULL;

ALTER TABLE analysis_requests 
  ADD COLUMN source_type text NOT NULL DEFAULT 'google_drive';