CREATE TABLE public.project_mitigation_plans (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Plan 1',
  summary text,
  control_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_project_mitigation_plans_project ON public.project_mitigation_plans(project_id, sort_order);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_mitigation_plans TO authenticated;
GRANT ALL ON public.project_mitigation_plans TO service_role;

ALTER TABLE public.project_mitigation_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View plans for accessible projects"
ON public.project_mitigation_plans FOR SELECT TO authenticated
USING (public.has_project_access(project_id));

CREATE POLICY "Edit plans for editable projects"
ON public.project_mitigation_plans FOR ALL TO authenticated
USING (public.can_edit_project(auth.uid(), project_id))
WITH CHECK (public.can_edit_project(auth.uid(), project_id));

CREATE TRIGGER update_project_mitigation_plans_updated_at
BEFORE UPDATE ON public.project_mitigation_plans
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();