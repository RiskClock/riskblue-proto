-- 1) Guest role becomes read-only
CREATE OR REPLACE FUNCTION public.tenant_role_permissions(_role tenant_role)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE _role
    WHEN 'admin' THEN '{
      "view_projects": true, "create_project": true, "edit_project": true,
      "delete_project": true, "export_report": true, "view_credits": true,
      "buy_credits": true, "manage_members": true, "manage_tenant_settings": true
    }'::jsonb
    WHEN 'member' THEN '{
      "view_projects": true, "create_project": true, "edit_project": true,
      "delete_project": false, "export_report": true, "view_credits": true,
      "buy_credits": true, "manage_members": false, "manage_tenant_settings": false
    }'::jsonb
    ELSE '{
      "view_projects": true, "create_project": false, "edit_project": false,
      "delete_project": false, "export_report": true, "view_credits": false,
      "buy_credits": false, "manage_members": false, "manage_tenant_settings": false
    }'::jsonb
  END;
$function$;

-- 2) Helper: may this user edit this project?
CREATE OR REPLACE FUNCTION public.can_edit_project(_user_id uuid, _project_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((
    SELECT (public.is_project_member(_user_id, p.id) OR p.user_id = _user_id)
       AND (
         p.tenant_id IS NULL
         OR public.tenant_has_permission(_user_id, p.tenant_id, 'edit_project')
       )
    FROM public.projects p
    WHERE p.id = _project_id
  ), false);
$function$;

-- 3) projects UPDATE
DROP POLICY IF EXISTS "Users can update projects they have access to" ON public.projects;
CREATE POLICY "Users can update projects they have access to"
ON public.projects FOR UPDATE
USING (
  is_internal_user(auth.uid())
  OR (
    public.can_edit_project(auth.uid(), id)
    AND ((NOT is_tenant_scoped_user(auth.uid())) OR (tenant_id IS NOT NULL AND is_tenant_member(auth.uid(), tenant_id)))
  )
);

-- 4) analysis_requests writes
DROP POLICY IF EXISTS "Users can insert analysis requests for their projects" ON public.analysis_requests;
CREATE POLICY "Users can insert analysis requests for their projects"
ON public.analysis_requests FOR INSERT
WITH CHECK (is_internal_user(auth.uid()) OR public.can_edit_project(auth.uid(), project_id));

DROP POLICY IF EXISTS "Users can update their own analysis requests" ON public.analysis_requests;
CREATE POLICY "Users can update their own analysis requests"
ON public.analysis_requests FOR UPDATE
USING (public.can_edit_project(auth.uid(), project_id))
WITH CHECK (public.can_edit_project(auth.uid(), project_id));

-- 5) analysis_request_sheets writes
DROP POLICY IF EXISTS "Users can insert sheets for their analysis requests" ON public.analysis_request_sheets;
CREATE POLICY "Users can insert sheets for their analysis requests"
ON public.analysis_request_sheets FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM public.analysis_requests ar
  WHERE ar.id = analysis_request_sheets.analysis_request_id
    AND (is_internal_user(auth.uid()) OR public.can_edit_project(auth.uid(), ar.project_id))
));

DROP POLICY IF EXISTS "Project members can update sheets" ON public.analysis_request_sheets;
CREATE POLICY "Project members can update sheets"
ON public.analysis_request_sheets FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM public.analysis_requests ar
  WHERE ar.id = analysis_request_sheets.analysis_request_id
    AND public.can_edit_project(auth.uid(), ar.project_id)
));

DROP POLICY IF EXISTS "Project members can delete sheets" ON public.analysis_request_sheets;
CREATE POLICY "Project members can delete sheets"
ON public.analysis_request_sheets FOR DELETE
USING (EXISTS (
  SELECT 1 FROM public.analysis_requests ar
  WHERE ar.id = analysis_request_sheets.analysis_request_id
    AND public.can_edit_project(auth.uid(), ar.project_id)
));

-- 6) drawing_instances writes (keep the processing lock)
DROP POLICY IF EXISTS "Project members can insert drawing instances when not processin" ON public.drawing_instances;
CREATE POLICY "Project members can insert drawing instances when not processin"
ON public.drawing_instances FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM public.analysis_requests ar
  JOIN public.projects p ON p.id = ar.project_id
  WHERE ar.id = drawing_instances.analysis_request_id
    AND public.can_edit_project(auth.uid(), p.id)
    AND COALESCE(p.workbench_status, 'processing') <> 'processing'
));

DROP POLICY IF EXISTS "Project members can update drawing instances when not processin" ON public.drawing_instances;
CREATE POLICY "Project members can update drawing instances when not processin"
ON public.drawing_instances FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM public.analysis_requests ar
  JOIN public.projects p ON p.id = ar.project_id
  WHERE ar.id = drawing_instances.analysis_request_id
    AND public.can_edit_project(auth.uid(), p.id)
    AND COALESCE(p.workbench_status, 'processing') <> 'processing'
));

DROP POLICY IF EXISTS "Project members can delete drawing instances when not processin" ON public.drawing_instances;
CREATE POLICY "Project members can delete drawing instances when not processin"
ON public.drawing_instances FOR DELETE
USING (EXISTS (
  SELECT 1 FROM public.analysis_requests ar
  JOIN public.projects p ON p.id = ar.project_id
  WHERE ar.id = drawing_instances.analysis_request_id
    AND public.can_edit_project(auth.uid(), p.id)
    AND COALESCE(p.workbench_status, 'processing') <> 'processing'
));