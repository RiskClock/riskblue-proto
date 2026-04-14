CREATE POLICY "Users can update their own analysis requests"
ON public.analysis_requests
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM projects
    WHERE projects.id = analysis_requests.project_id
    AND projects.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM projects
    WHERE projects.id = analysis_requests.project_id
    AND projects.user_id = auth.uid()
  )
);