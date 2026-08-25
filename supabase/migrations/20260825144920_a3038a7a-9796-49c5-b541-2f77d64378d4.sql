CREATE INDEX IF NOT EXISTS idx_projects_user_id_created_at
ON public.projects (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_analysis_requests_project_created_at
ON public.analysis_requests (project_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.get_project_list_summaries(
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  name text,
  user_id uuid,
  created_at timestamptz,
  status text,
  credits_consumed integer,
  report_file_path text,
  report_file_name text,
  workbench_status text,
  creator_name text,
  creator_email text,
  user_role public.project_role
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.name,
    p.user_id,
    p.created_at,
    p.status,
    p.credits_consumed,
    p.report_file_path,
    p.report_file_name,
    p.workbench_status,
    COALESCE(NULLIF(pr.display_name, ''), split_part(au.email, '@', 1), 'Unknown') AS creator_name,
    COALESCE(au.email, '') AS creator_email,
    pur.role AS user_role
  FROM public.projects p
  LEFT JOIN public.profiles pr ON pr.user_id = p.user_id
  LEFT JOIN auth.users au ON au.id = p.user_id
  LEFT JOIN public.project_user_roles pur
    ON pur.project_id = p.id
   AND pur.user_id = auth.uid()
  WHERE auth.uid() IS NOT NULL
    AND (
      CASE
        WHEN public.is_internal_user(auth.uid()) THEN
          p.user_id = auth.uid() OR public.is_project_member(auth.uid(), p.id)
        ELSE
          p.user_id = auth.uid() OR public.is_project_member(auth.uid(), p.id)
      END
    )
  ORDER BY p.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

CREATE OR REPLACE FUNCTION public.get_workbench_project_summaries(
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  name text,
  user_id uuid,
  created_at timestamptz,
  account_type text,
  creator_name text,
  creator_email text,
  company text,
  is_internal boolean,
  file_count integer,
  total_size_bytes bigint,
  status text,
  workbench_status text,
  pipeline_phase text,
  error_message text,
  pipeline_progress_done integer,
  pipeline_progress_total integer,
  request_updated_at timestamptz,
  analysis_request_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.name,
    p.user_id,
    p.created_at,
    COALESCE(pr.account_type, 'standard') AS account_type,
    COALESCE(NULLIF(pr.display_name, ''), split_part(au.email, '@', 1), 'Unknown') AS creator_name,
    COALESCE(au.email, '') AS creator_email,
    pr.company,
    COALESCE(au.email ILIKE '%@riskclock.com', false) AS is_internal,
    COALESCE(ar.file_count, 0) AS file_count,
    ar.total_size_bytes,
    ar.status,
    p.workbench_status,
    ar.pipeline_phase,
    ar.error_message,
    ar.pipeline_progress_done,
    ar.pipeline_progress_total,
    ar.updated_at AS request_updated_at,
    ar.id AS analysis_request_id
  FROM public.projects p
  LEFT JOIN public.profiles pr ON pr.user_id = p.user_id
  LEFT JOIN auth.users au ON au.id = p.user_id
  LEFT JOIN LATERAL (
    SELECT
      id,
      status,
      file_count,
      total_size_bytes,
      pipeline_phase,
      error_message,
      pipeline_progress_done,
      pipeline_progress_total,
      updated_at
    FROM public.analysis_requests ar
    WHERE ar.project_id = p.id
    ORDER BY ar.created_at DESC
    LIMIT 1
  ) ar ON true
  WHERE auth.uid() IS NOT NULL
    AND public.is_internal_user(auth.uid())
  ORDER BY p.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

GRANT EXECUTE ON FUNCTION public.get_project_list_summaries(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_workbench_project_summaries(integer, integer) TO authenticated;