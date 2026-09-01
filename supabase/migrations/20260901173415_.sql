-- Allow tenant members to purchase credits for the shared company pool.
-- Admins already have this permission; this updates the default member template
-- and backfills active members who do not have an explicit override set.

CREATE OR REPLACE FUNCTION public.tenant_role_permissions(_role public.tenant_role)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE _role
    WHEN 'admin' THEN '{
      "view_projects": true, "create_project": true, "edit_project": true,
      "delete_project": true, "export_report": true, "view_credits": true,
      "buy_credits": true, "manage_members": true, "manage_tenant_settings": true
    }'::jsonb
    WHEN 'member' THEN '{
      "view_projects": true, "create_project": true, "edit_project": true,
      "delete_project": false, "export_report": true, "view_credits": true,
      "buy_credits": true, "manage_members": false, "manage_tenant_settings": false
    }'::jsonb
    ELSE '{
      "view_projects": true, "create_project": false, "edit_project": true,
      "delete_project": false, "export_report": true, "view_credits": false,
      "buy_credits": false, "manage_members": false, "manage_tenant_settings": false
    }'::jsonb
  END;
$$;

-- Backfill existing active members: set buy_credits override to true only when
-- they haven't explicitly been denied the permission.
UPDATE public.tenant_members
SET permission_overrides = permission_overrides || '{"buy_credits": true}'::jsonb
WHERE role = 'member'
  AND status = 'active'
  AND COALESCE(permission_overrides->>'buy_credits', '') != 'false';
