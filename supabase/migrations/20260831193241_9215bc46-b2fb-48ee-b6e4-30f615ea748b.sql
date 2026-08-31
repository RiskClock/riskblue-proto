REVOKE ALL ON FUNCTION public.is_tenant_member(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.tenant_member_role(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.tenant_has_permission(uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.get_my_tenants() FROM anon;
REVOKE ALL ON FUNCTION public.get_tenant_summaries() FROM anon;
REVOKE ALL ON FUNCTION public.enforce_last_tenant_admin() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_tenant_credits(uuid, integer, uuid, uuid) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_adjust_tenant_credits(uuid, integer, text) FROM anon;