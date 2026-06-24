CREATE OR REPLACE FUNCTION public.find_orphaned_uploaded_drawings()
RETURNS TABLE(name text, size bigint, created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    o.name,
    COALESCE((o.metadata->>'size')::bigint, 0) AS size,
    o.created_at
  FROM storage.objects o
  WHERE o.bucket_id = 'uploaded-drawings'
    AND public.is_internal_user(auth.uid())
    AND NOT EXISTS (
      SELECT 1 FROM public.analysis_request_files f WHERE f.storage_path = o.name
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.analysis_request_sheets s WHERE s.storage_path = o.name
    )
  ORDER BY o.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.find_orphaned_uploaded_drawings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_orphaned_uploaded_drawings() TO authenticated;