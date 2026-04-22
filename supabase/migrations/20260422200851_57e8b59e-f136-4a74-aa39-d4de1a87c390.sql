-- Update INSERT policy on analysis_request_files to include project members
DROP POLICY IF EXISTS "Users can insert files for their analysis requests" ON public.analysis_request_files;

CREATE POLICY "Users can insert files for their analysis requests"
ON public.analysis_request_files
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.analysis_requests ar
    JOIN public.projects p ON p.id = ar.project_id
    WHERE ar.id = analysis_request_files.analysis_request_id
      AND (
        p.user_id = auth.uid()
        OR public.is_internal_user(auth.uid())
        OR public.is_project_member(auth.uid(), p.id)
      )
  )
);

-- Update SELECT policy on analysis_request_files to include project members
DROP POLICY IF EXISTS "Users can view files for their analysis requests" ON public.analysis_request_files;

CREATE POLICY "Users can view files for their analysis requests"
ON public.analysis_request_files
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.analysis_requests ar
    JOIN public.projects p ON p.id = ar.project_id
    WHERE ar.id = analysis_request_files.analysis_request_id
      AND (
        p.user_id = auth.uid()
        OR public.is_internal_user(auth.uid())
        OR public.is_project_member(auth.uid(), p.id)
      )
  )
);

-- Also allow project members to update analysis_requests (so file_count/status can be bumped)
DROP POLICY IF EXISTS "Users can update their own analysis requests" ON public.analysis_requests;

CREATE POLICY "Users can update their own analysis requests"
ON public.analysis_requests
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = analysis_requests.project_id
      AND (p.user_id = auth.uid() OR public.is_project_member(auth.uid(), p.id))
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = analysis_requests.project_id
      AND (p.user_id = auth.uid() OR public.is_project_member(auth.uid(), p.id))
  )
);

-- Allow project members to insert analysis_requests too
DROP POLICY IF EXISTS "Users can insert analysis requests for their projects" ON public.analysis_requests;

CREATE POLICY "Users can insert analysis requests for their projects"
ON public.analysis_requests
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = analysis_requests.project_id
      AND (p.user_id = auth.uid() OR public.is_project_member(auth.uid(), p.id))
  )
  OR public.is_internal_user(auth.uid())
);