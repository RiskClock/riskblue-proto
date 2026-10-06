CREATE TABLE public.project_class_prompt_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  awp_class_name text NOT NULL,
  prompt_content text NOT NULL,
  calibration_notes jsonb,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, awp_class_name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_class_prompt_overrides TO authenticated;
GRANT ALL ON public.project_class_prompt_overrides TO service_role;
ALTER TABLE public.project_class_prompt_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "System admins manage class prompt overrides"
  ON public.project_class_prompt_overrides FOR ALL TO authenticated
  USING (public.is_system_admin(auth.uid()))
  WITH CHECK (public.is_system_admin(auth.uid()));
CREATE TRIGGER update_project_class_prompt_overrides_updated_at
  BEFORE UPDATE ON public.project_class_prompt_overrides
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();