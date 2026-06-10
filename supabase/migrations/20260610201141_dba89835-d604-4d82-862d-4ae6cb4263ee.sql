CREATE POLICY "Project co-members can view profiles"
ON public.profiles FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.project_user_roles r1
    JOIN public.project_user_roles r2 ON r1.project_id = r2.project_id
    WHERE r1.user_id = auth.uid()
      AND r2.user_id = profiles.user_id
  )
);