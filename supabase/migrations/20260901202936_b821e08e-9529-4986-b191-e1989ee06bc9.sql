CREATE OR REPLACE FUNCTION public.get_project_list_summaries(p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_tenant_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, name text, user_id uuid, created_at timestamp with time zone, status text, credits_consumed integer, report_file_path text, report_file_name text, workbench_status text, creator_name text, creator_email text, user_role project_role, tenant_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    COALESCE(NULLIF(pr.display_name, ''), 'Unknown') AS creator_name,
    ''::text AS creator_email,
    pur.role AS user_role,
    p.tenant_id
  FROM public.projects p
  LEFT JOIN public.profiles pr ON pr.user_id = p.user_id
  LEFT JOIN public.project_user_roles pur
    ON pur.project_id = p.id
   AND pur.user_id = auth.uid()
  WHERE auth.uid() IS NOT NULL
    AND (
      CASE
        WHEN p_tenant_id IS NOT NULL THEN
          p.tenant_id = p_tenant_id
          AND public.is_tenant_member(auth.uid(), p_tenant_id)
        ELSE
          p.tenant_id IS NULL
          AND (
            p.user_id = auth.uid()
            OR public.is_project_member(auth.uid(), p.id)
          )
      END
    )
  ORDER BY p.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$function$;