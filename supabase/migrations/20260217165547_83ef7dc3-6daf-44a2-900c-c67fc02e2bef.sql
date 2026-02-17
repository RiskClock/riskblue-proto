-- Allow internal users to delete analysis request files
CREATE POLICY "Internal users can delete analysis request files"
ON public.analysis_request_files
FOR DELETE
USING (is_internal_user(auth.uid()));

-- Allow internal users to delete analysis requests
CREATE POLICY "Internal users can delete analysis requests"
ON public.analysis_requests
FOR DELETE
USING (is_internal_user(auth.uid()));