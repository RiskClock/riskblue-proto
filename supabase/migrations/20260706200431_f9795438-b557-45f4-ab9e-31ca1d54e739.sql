
CREATE TABLE public.project_class_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  awp_class_name text NOT NULL,
  alias text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, awp_class_name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_class_aliases TO authenticated;
GRANT ALL ON public.project_class_aliases TO service_role;

ALTER TABLE public.project_class_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project members can view aliases"
  ON public.project_class_aliases FOR SELECT TO authenticated
  USING (public.is_project_member(auth.uid(), project_id) OR public.is_internal_user(auth.uid()));

CREATE POLICY "Project members can insert aliases"
  ON public.project_class_aliases FOR INSERT TO authenticated
  WITH CHECK (public.is_project_member(auth.uid(), project_id) OR public.is_internal_user(auth.uid()));

CREATE POLICY "Project members can update aliases"
  ON public.project_class_aliases FOR UPDATE TO authenticated
  USING (public.is_project_member(auth.uid(), project_id) OR public.is_internal_user(auth.uid()))
  WITH CHECK (public.is_project_member(auth.uid(), project_id) OR public.is_internal_user(auth.uid()));

CREATE POLICY "Project members can delete aliases"
  ON public.project_class_aliases FOR DELETE TO authenticated
  USING (public.is_project_member(auth.uid(), project_id) OR public.is_internal_user(auth.uid()));

CREATE TRIGGER update_project_class_aliases_updated_at
  BEFORE UPDATE ON public.project_class_aliases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
