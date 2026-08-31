-- 1. Enum for tenant roles
DO $$ BEGIN
  CREATE TYPE public.tenant_role AS ENUM ('admin', 'member', 'guest');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Tenants
CREATE TABLE IF NOT EXISTS public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE,
  credits_balance integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenants TO authenticated;
GRANT ALL ON public.tenants TO service_role;
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

-- 3. Tenant members
CREATE TABLE IF NOT EXISTS public.tenant_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role public.tenant_role NOT NULL DEFAULT 'member',
  permission_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active',
  invited_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_members TO authenticated;
GRANT ALL ON public.tenant_members TO service_role;
ALTER TABLE public.tenant_members ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_tenant_members_user ON public.tenant_members(user_id);
CREATE INDEX IF NOT EXISTS idx_tenant_members_tenant ON public.tenant_members(tenant_id);

-- 4. Tenant invitations
CREATE TABLE IF NOT EXISTS public.tenant_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  email text NOT NULL,
  role public.tenant_role NOT NULL DEFAULT 'member',
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  invited_by uuid,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_invitations TO authenticated;
GRANT ALL ON public.tenant_invitations TO service_role;
ALTER TABLE public.tenant_invitations ENABLE ROW LEVEL SECURITY;

-- 5. Tenant credit transactions
CREATE TABLE IF NOT EXISTS public.tenant_credit_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  delta integer NOT NULL,
  reason text NOT NULL,
  actor_user_id uuid,
  project_id uuid,
  analysis_request_id uuid,
  package_label text,
  amount_cents integer,
  stripe_session_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.tenant_credit_transactions TO authenticated;
GRANT ALL ON public.tenant_credit_transactions TO service_role;
ALTER TABLE public.tenant_credit_transactions ENABLE ROW LEVEL SECURITY;

-- 6. Column additions
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_accessed_tenant_id uuid;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS public_share_token text UNIQUE;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS public_share_expires_at timestamptz;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS public_share_revoked boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_projects_tenant ON public.projects(tenant_id);

-- 7. Permission templates
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
      "buy_credits": false, "manage_members": false, "manage_tenant_settings": false
    }'::jsonb
    ELSE '{
      "view_projects": true, "create_project": false, "edit_project": true,
      "delete_project": false, "export_report": true, "view_credits": false,
      "buy_credits": false, "manage_members": false, "manage_tenant_settings": false
    }'::jsonb
  END;
$$;

-- 8. Membership + permission helpers
CREATE OR REPLACE FUNCTION public.is_tenant_member(_user_id uuid, _tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenant_members tm
    JOIN public.tenants t ON t.id = tm.tenant_id
    WHERE tm.user_id = _user_id
      AND tm.tenant_id = _tenant_id
      AND tm.status = 'active'
      AND t.is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.tenant_member_role(_user_id uuid, _tenant_id uuid)
RETURNS public.tenant_role
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tm.role
  FROM public.tenant_members tm
  JOIN public.tenants t ON t.id = tm.tenant_id
  WHERE tm.user_id = _user_id
    AND tm.tenant_id = _tenant_id
    AND tm.status = 'active'
    AND t.is_active = true
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.tenant_has_permission(_user_id uuid, _tenant_id uuid, _flag text)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role public.tenant_role;
  v_overrides jsonb;
  v_perms jsonb;
BEGIN
  SELECT tm.role, tm.permission_overrides
  INTO v_role, v_overrides
  FROM public.tenant_members tm
  JOIN public.tenants t ON t.id = tm.tenant_id
  WHERE tm.user_id = _user_id
    AND tm.tenant_id = _tenant_id
    AND tm.status = 'active'
    AND t.is_active = true
  LIMIT 1;

  IF v_role IS NULL THEN
    RETURN false;
  END IF;

  v_perms := public.tenant_role_permissions(v_role) || COALESCE(v_overrides, '{}'::jsonb);
  RETURN COALESCE((v_perms->>_flag)::boolean, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_tenants()
RETURNS TABLE(
  id uuid,
  name text,
  slug text,
  credits_balance integer,
  role public.tenant_role,
  permissions jsonb
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.id,
    t.name,
    t.slug,
    CASE WHEN public.tenant_has_permission(auth.uid(), t.id, 'view_credits')
         THEN t.credits_balance ELSE NULL END AS credits_balance,
    tm.role,
    public.tenant_role_permissions(tm.role) || COALESCE(tm.permission_overrides, '{}'::jsonb) AS permissions
  FROM public.tenant_members tm
  JOIN public.tenants t ON t.id = tm.tenant_id
  WHERE tm.user_id = auth.uid()
    AND tm.status = 'active'
    AND t.is_active = true
  ORDER BY t.name ASC;
$$;

-- 9. Public share token helper
CREATE OR REPLACE FUNCTION public.current_share_token()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT NULLIF(
    COALESCE(
      current_setting('request.headers', true)::json->>'x-share-token',
      ''
    ), ''
  );
$$;

-- 10. Last-admin protection
CREATE OR REPLACE FUNCTION public.enforce_last_tenant_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admins integer;
  v_was_admin boolean;
  v_still_admin boolean;
BEGIN
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
$$;

DROP TRIGGER IF EXISTS trg_last_tenant_admin ON public.tenant_members;
CREATE TRIGGER trg_last_tenant_admin
BEFORE UPDATE OR DELETE ON public.tenant_members
FOR EACH ROW EXECUTE FUNCTION public.enforce_last_tenant_admin();

-- 11. updated_at triggers
DROP TRIGGER IF EXISTS trg_tenants_updated_at ON public.tenants;
CREATE TRIGGER trg_tenants_updated_at BEFORE UPDATE ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_tenant_members_updated_at ON public.tenant_members;
CREATE TRIGGER trg_tenant_members_updated_at BEFORE UPDATE ON public.tenant_members
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_tenant_invitations_updated_at ON public.tenant_invitations;
CREATE TRIGGER trg_tenant_invitations_updated_at BEFORE UPDATE ON public.tenant_invitations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 12. Credit functions
CREATE OR REPLACE FUNCTION public.consume_tenant_credits(p_tenant_id uuid, p_amount integer, p_analysis_request_id uuid DEFAULT NULL, p_project_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance integer;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_amount');
  END IF;

  SELECT credits_balance INTO v_balance
  FROM public.tenants WHERE id = p_tenant_id FOR UPDATE;

  IF v_balance IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'no_tenant');
  END IF;

  IF v_balance < p_amount THEN
    RETURN jsonb_build_object('success', false, 'balance', v_balance, 'required', p_amount, 'reason', 'insufficient_credits');
  END IF;

  UPDATE public.tenants
  SET credits_balance = credits_balance - p_amount, updated_at = now()
  WHERE id = p_tenant_id;

  INSERT INTO public.tenant_credit_transactions (tenant_id, delta, reason, actor_user_id, analysis_request_id, project_id)
  VALUES (p_tenant_id, -p_amount, 'analysis_consumed', auth.uid(), p_analysis_request_id, p_project_id);

  RETURN jsonb_build_object('success', true, 'balance', v_balance - p_amount, 'consumed', p_amount);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_adjust_tenant_credits(p_tenant_id uuid, p_new_balance integer, p_reason text DEFAULT 'admin_adjust')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old integer;
  v_delta integer;
BEGIN
  IF NOT public.is_internal_user(auth.uid()) THEN
    RAISE EXCEPTION 'Only internal users can adjust company credits';
  END IF;
  IF p_new_balance < 0 THEN
    RAISE EXCEPTION 'Balance cannot be negative';
  END IF;

  SELECT credits_balance INTO v_old FROM public.tenants WHERE id = p_tenant_id FOR UPDATE;
  IF v_old IS NULL THEN
    RAISE EXCEPTION 'Company not found';
  END IF;

  v_delta := p_new_balance - v_old;
  IF v_delta = 0 THEN
    RETURN jsonb_build_object('success', true, 'changed', false, 'balance', v_old);
  END IF;

  UPDATE public.tenants SET credits_balance = p_new_balance, updated_at = now() WHERE id = p_tenant_id;

  INSERT INTO public.tenant_credit_transactions (tenant_id, delta, reason, actor_user_id)
  VALUES (p_tenant_id, v_delta, p_reason, auth.uid());

  RETURN jsonb_build_object('success', true, 'changed', true, 'balance', p_new_balance, 'delta', v_delta);
END;
$$;

-- 13. Internal summary RPC for the Company Management page
CREATE OR REPLACE FUNCTION public.get_tenant_summaries()
RETURNS TABLE(
  id uuid,
  name text,
  slug text,
  credits_balance integer,
  is_active boolean,
  created_at timestamptz,
  member_count integer,
  project_count integer
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.id, t.name, t.slug, t.credits_balance, t.is_active, t.created_at,
    (SELECT count(*)::int FROM public.tenant_members tm WHERE tm.tenant_id = t.id AND tm.status = 'active'),
    (SELECT count(*)::int FROM public.projects p WHERE p.tenant_id = t.id)
  FROM public.tenants t
  WHERE public.is_internal_user(auth.uid())
  ORDER BY t.name ASC;
$$;

-- 14. RLS policies: tenants
DROP POLICY IF EXISTS "Members can view their tenants" ON public.tenants;
CREATE POLICY "Members can view their tenants" ON public.tenants
FOR SELECT TO authenticated
USING (public.is_tenant_member(auth.uid(), id) OR public.is_internal_user(auth.uid()));

DROP POLICY IF EXISTS "Internal users manage tenants" ON public.tenants;
CREATE POLICY "Internal users manage tenants" ON public.tenants
FOR ALL TO authenticated
USING (public.is_internal_user(auth.uid()))
WITH CHECK (public.is_internal_user(auth.uid()));

DROP POLICY IF EXISTS "Tenant admins can update settings" ON public.tenants;
CREATE POLICY "Tenant admins can update settings" ON public.tenants
FOR UPDATE TO authenticated
USING (public.tenant_has_permission(auth.uid(), id, 'manage_tenant_settings'))
WITH CHECK (public.tenant_has_permission(auth.uid(), id, 'manage_tenant_settings'));

-- 15. RLS policies: tenant_members
DROP POLICY IF EXISTS "Members can view co-members" ON public.tenant_members;
CREATE POLICY "Members can view co-members" ON public.tenant_members
FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR public.is_tenant_member(auth.uid(), tenant_id)
  OR public.is_internal_user(auth.uid())
);

DROP POLICY IF EXISTS "Admins manage members" ON public.tenant_members;
CREATE POLICY "Admins manage members" ON public.tenant_members
FOR ALL TO authenticated
USING (
  public.tenant_has_permission(auth.uid(), tenant_id, 'manage_members')
  OR public.is_internal_user(auth.uid())
)
WITH CHECK (
  public.tenant_has_permission(auth.uid(), tenant_id, 'manage_members')
  OR public.is_internal_user(auth.uid())
);

-- 16. RLS policies: tenant_invitations
DROP POLICY IF EXISTS "Admins manage invitations" ON public.tenant_invitations;
CREATE POLICY "Admins manage invitations" ON public.tenant_invitations
FOR ALL TO authenticated
USING (
  public.tenant_has_permission(auth.uid(), tenant_id, 'manage_members')
  OR public.is_internal_user(auth.uid())
)
WITH CHECK (
  public.tenant_has_permission(auth.uid(), tenant_id, 'manage_members')
  OR public.is_internal_user(auth.uid())
);

-- 17. RLS policies: tenant_credit_transactions
DROP POLICY IF EXISTS "Credit viewers can read tenant transactions" ON public.tenant_credit_transactions;
CREATE POLICY "Credit viewers can read tenant transactions" ON public.tenant_credit_transactions
FOR SELECT TO authenticated
USING (
  public.tenant_has_permission(auth.uid(), tenant_id, 'view_credits')
  OR public.is_internal_user(auth.uid())
);

-- 18. Projects: tenant-scoped + share-token access
DROP POLICY IF EXISTS "Tenant members can view tenant projects" ON public.projects;
CREATE POLICY "Tenant members can view tenant projects" ON public.projects
FOR SELECT TO authenticated
USING (tenant_id IS NOT NULL AND public.is_tenant_member(auth.uid(), tenant_id));

DROP POLICY IF EXISTS "Tenant editors can update tenant projects" ON public.projects;
CREATE POLICY "Tenant editors can update tenant projects" ON public.projects
FOR UPDATE TO authenticated
USING (tenant_id IS NOT NULL AND public.tenant_has_permission(auth.uid(), tenant_id, 'edit_project'))
WITH CHECK (tenant_id IS NOT NULL AND public.tenant_has_permission(auth.uid(), tenant_id, 'edit_project'));

DROP POLICY IF EXISTS "Tenant creators can insert tenant projects" ON public.projects;
CREATE POLICY "Tenant creators can insert tenant projects" ON public.projects
FOR INSERT TO authenticated
WITH CHECK (
  tenant_id IS NULL
  OR public.tenant_has_permission(auth.uid(), tenant_id, 'create_project')
);

DROP POLICY IF EXISTS "Tenant admins can delete tenant projects" ON public.projects;
CREATE POLICY "Tenant admins can delete tenant projects" ON public.projects
FOR DELETE TO authenticated
USING (tenant_id IS NOT NULL AND public.tenant_has_permission(auth.uid(), tenant_id, 'delete_project'));

DROP POLICY IF EXISTS "Valid public share token can view project" ON public.projects;
CREATE POLICY "Valid public share token can view project" ON public.projects
FOR SELECT
USING (
  public_share_token IS NOT NULL
  AND public_share_revoked = false
  AND (public_share_expires_at IS NULL OR public_share_expires_at > now())
  AND public_share_token = public.current_share_token()
);

GRANT SELECT ON public.projects TO anon;