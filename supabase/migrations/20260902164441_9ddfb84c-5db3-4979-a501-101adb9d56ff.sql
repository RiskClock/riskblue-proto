UPDATE public.projects p
SET tenant_id = sub.tenant_id
FROM (
  SELECT m.user_id, (array_agg(m.tenant_id))[1] AS tenant_id
  FROM public.tenant_members m
  JOIN public.tenants t ON t.id = m.tenant_id AND t.is_active
  GROUP BY m.user_id
  HAVING count(*) = 1
) sub
WHERE p.user_id = sub.user_id AND p.tenant_id IS NULL;