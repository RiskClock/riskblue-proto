CREATE TABLE public.tenant_control_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  control_id uuid NOT NULL REFERENCES public.mitigation_controls(id) ON DELETE CASCADE,
  critical_asset_ids uuid[] NOT NULL DEFAULT '{}',
  water_system_ids uuid[] NOT NULL DEFAULT '{}',
  process_ids uuid[] NOT NULL DEFAULT '{}',
  assets_customized boolean NOT NULL DEFAULT false,
  one_time_cost numeric,
  monthly_maint_cost numeric,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, control_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_control_overrides TO authenticated;
GRANT ALL ON public.tenant_control_overrides TO service_role;

ALTER TABLE public.tenant_control_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view tenant control overrides"
ON public.tenant_control_overrides FOR SELECT TO authenticated
USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_internal_user(auth.uid()));

CREATE POLICY "Managers insert tenant control overrides"
ON public.tenant_control_overrides FOR INSERT TO authenticated
WITH CHECK (public.can_manage_tenant_controls(auth.uid(), tenant_id));

CREATE POLICY "Managers update tenant control overrides"
ON public.tenant_control_overrides FOR UPDATE TO authenticated
USING (public.can_manage_tenant_controls(auth.uid(), tenant_id))
WITH CHECK (public.can_manage_tenant_controls(auth.uid(), tenant_id));

CREATE POLICY "Managers delete tenant control overrides"
ON public.tenant_control_overrides FOR DELETE TO authenticated
USING (public.can_manage_tenant_controls(auth.uid(), tenant_id));

CREATE TRIGGER update_tenant_control_overrides_updated_at
BEFORE UPDATE ON public.tenant_control_overrides
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();