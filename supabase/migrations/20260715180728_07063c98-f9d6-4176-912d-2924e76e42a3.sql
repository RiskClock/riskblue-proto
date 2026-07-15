DROP POLICY IF EXISTS "Internal users can view workbench column prefs" ON public.workbench_column_preferences;

CREATE POLICY "View workbench column prefs by project access or internal"
ON public.workbench_column_preferences
FOR SELECT TO authenticated
USING (
  public.is_internal_user(auth.uid())
  OR EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id::text = workbench_column_preferences.id
      AND (p.user_id = auth.uid() OR public.has_project_access(p.id))
  )
);