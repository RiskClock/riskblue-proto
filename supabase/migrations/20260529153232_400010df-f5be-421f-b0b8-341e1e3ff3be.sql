CREATE POLICY "Internal users can delete any project"
ON public.projects
FOR DELETE
TO authenticated
USING (is_internal_user(auth.uid()));