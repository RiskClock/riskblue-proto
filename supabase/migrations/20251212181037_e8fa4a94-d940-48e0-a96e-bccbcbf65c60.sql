-- Create a public storage bucket for entity images (AWP and controls)
INSERT INTO storage.buckets (id, name, public)
VALUES ('entity-images', 'entity-images', true);

-- Allow anyone to view images (public bucket)
CREATE POLICY "Anyone can view entity images"
ON storage.objects
FOR SELECT
USING (bucket_id = 'entity-images');

-- Allow admins to upload/update/delete images
CREATE POLICY "Admins can upload entity images"
ON storage.objects
FOR INSERT
WITH CHECK (bucket_id = 'entity-images' AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update entity images"
ON storage.objects
FOR UPDATE
USING (bucket_id = 'entity-images' AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete entity images"
ON storage.objects
FOR DELETE
USING (bucket_id = 'entity-images' AND has_role(auth.uid(), 'admin'::app_role));