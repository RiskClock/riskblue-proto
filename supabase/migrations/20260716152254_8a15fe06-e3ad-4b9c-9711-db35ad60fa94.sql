-- Allow project members (including WMSV) to add/edit/delete drawing annotations
-- on projects that are not currently processing. Internal users retain full access.
CREATE POLICY "Project members can insert drawing instances when not processing"
ON public.drawing_instances
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.analysis_requests ar
    JOIN public.projects p ON p.id = ar.project_id
    WHERE ar.id = drawing_instances.analysis_request_id
      AND ((p.user_id = auth.uid()) OR public.is_project_member(auth.uid(), p.id))
      AND COALESCE(p.workbench_status, 'processing') <> 'processing'
  )
);

CREATE POLICY "Project members can update drawing instances when not processing"
ON public.drawing_instances
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.analysis_requests ar
    JOIN public.projects p ON p.id = ar.project_id
    WHERE ar.id = drawing_instances.analysis_request_id
      AND ((p.user_id = auth.uid()) OR public.is_project_member(auth.uid(), p.id))
      AND COALESCE(p.workbench_status, 'processing') <> 'processing'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.analysis_requests ar
    JOIN public.projects p ON p.id = ar.project_id
    WHERE ar.id = drawing_instances.analysis_request_id
      AND ((p.user_id = auth.uid()) OR public.is_project_member(auth.uid(), p.id))
      AND COALESCE(p.workbench_status, 'processing') <> 'processing'
  )
);

CREATE POLICY "Project members can delete drawing instances when not processing"
ON public.drawing_instances
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.analysis_requests ar
    JOIN public.projects p ON p.id = ar.project_id
    WHERE ar.id = drawing_instances.analysis_request_id
      AND ((p.user_id = auth.uid()) OR public.is_project_member(auth.uid(), p.id))
      AND COALESCE(p.workbench_status, 'processing') <> 'processing'
  )
);