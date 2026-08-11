CREATE POLICY "Project members can log project activity"
ON public.project_audit_events
FOR INSERT
TO authenticated
WITH CHECK (
  actor_user_id = auth.uid()
  AND project_id IS NOT NULL
  AND (public.is_internal_user(auth.uid()) OR public.has_project_access(project_id))
);