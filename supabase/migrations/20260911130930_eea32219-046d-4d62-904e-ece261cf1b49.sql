DROP POLICY IF EXISTS "Internal users can view project audit events" ON public.project_audit_events;
CREATE POLICY "Project members can view project audit events"
ON public.project_audit_events
FOR SELECT
TO authenticated
USING (public.is_internal_user(auth.uid()) OR public.has_project_access(project_id));