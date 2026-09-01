UPDATE public.projects p
SET tenant_id = '06299883-82fa-4c28-94ae-fe5540b6b5cf'
WHERE p.tenant_id IS NULL
  AND p.user_id IN (
    SELECT tm.user_id FROM public.tenant_members tm
    WHERE tm.tenant_id = '06299883-82fa-4c28-94ae-fe5540b6b5cf'
      AND tm.status = 'active'
  );