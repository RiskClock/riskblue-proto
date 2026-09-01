UPDATE public.projects p
SET tenant_id = tm.tenant_id
FROM public.tenant_members tm
WHERE tm.user_id = p.user_id
  AND tm.status = 'active'
  AND p.tenant_id IS NULL
  AND tm.tenant_id IN ('1a6d79bd-aeb3-4fe5-9842-767c560d5241','a6e26228-f8bc-4b8b-bc27-87ed301cb029');