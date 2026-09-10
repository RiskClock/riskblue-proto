DROP INDEX IF EXISTS public.company_control_selections_tenant_control_uidx;
CREATE UNIQUE INDEX company_control_selections_tenant_control_uidx
  ON public.company_control_selections (tenant_id, category, control_id);