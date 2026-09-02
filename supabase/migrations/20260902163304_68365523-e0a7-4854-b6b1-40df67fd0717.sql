-- Allow last-admin trigger to be bypassed during full tenant deletion
CREATE OR REPLACE FUNCTION public.enforce_last_tenant_admin()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_admins integer;
  v_was_admin boolean;
  v_still_admin boolean;
BEGIN
  IF COALESCE(current_setting('app.deleting_tenant', true), '') = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_was_admin := (OLD.role = 'admin' AND OLD.status = 'active');
  IF NOT v_was_admin THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_still_admin := false;
  ELSE
    v_still_admin := (NEW.role = 'admin' AND NEW.status = 'active');
  END IF;

  IF v_still_admin THEN
    RETURN NEW;
  END IF;

  SELECT count(*)::int INTO v_admins
  FROM public.tenant_members
  WHERE tenant_id = OLD.tenant_id
    AND role = 'admin'
    AND status = 'active'
    AND id <> OLD.id;

  IF v_admins = 0 THEN
    RAISE EXCEPTION 'Cannot remove or downgrade the last remaining admin of this company';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_tenant(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_name text;
  v_projects integer;
BEGIN
  IF NOT public.is_internal_user(auth.uid()) THEN
    RAISE EXCEPTION 'Only internal users can delete companies';
  END IF;

  SELECT name INTO v_name FROM public.tenants WHERE id = p_tenant_id;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Company not found';
  END IF;

  PERFORM set_config('app.deleting_tenant', 'on', true);

  -- Detach projects (kept, but no longer company-scoped)
  UPDATE public.projects SET tenant_id = NULL WHERE tenant_id = p_tenant_id
  ;
  GET DIAGNOSTICS v_projects = ROW_COUNT;

  UPDATE public.profiles SET last_accessed_tenant_id = NULL WHERE last_accessed_tenant_id = p_tenant_id;

  DELETE FROM public.tenant_members WHERE tenant_id = p_tenant_id;
  DELETE FROM public.tenants WHERE id = p_tenant_id;

  PERFORM set_config('app.deleting_tenant', 'off', true);

  RETURN jsonb_build_object('success', true, 'name', v_name, 'projects_detached', v_projects);
END;
$function$;