REVOKE ALL ON FUNCTION public.is_tenant_scoped_user(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_tenant_scoped_user(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_tenant_scoped_user(uuid) TO authenticated, service_role;