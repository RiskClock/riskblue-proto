REVOKE EXECUTE ON FUNCTION public.get_my_tenants() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_tenants() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_tenants() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_tenant_summaries() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_tenant_summaries() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_tenant_summaries() TO authenticated;