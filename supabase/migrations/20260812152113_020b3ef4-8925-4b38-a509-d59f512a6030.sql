CREATE TABLE public.refinery_datasets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  analysis_request_id uuid REFERENCES public.analysis_requests(id) ON DELETE SET NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.refinery_datasets TO authenticated;
GRANT ALL ON public.refinery_datasets TO service_role;
ALTER TABLE public.refinery_datasets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Internal users manage refinery datasets"
  ON public.refinery_datasets FOR ALL TO authenticated
  USING (public.is_internal_user(auth.uid()))
  WITH CHECK (public.is_internal_user(auth.uid()));
CREATE TRIGGER update_refinery_datasets_updated_at
  BEFORE UPDATE ON public.refinery_datasets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.refinery_prompt_datasets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_id uuid NOT NULL REFERENCES public.refinery_prompts(id) ON DELETE CASCADE,
  dataset_id uuid NOT NULL REFERENCES public.refinery_datasets(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (prompt_id, dataset_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.refinery_prompt_datasets TO authenticated;
GRANT ALL ON public.refinery_prompt_datasets TO service_role;
ALTER TABLE public.refinery_prompt_datasets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Internal users manage refinery prompt datasets"
  ON public.refinery_prompt_datasets FOR ALL TO authenticated
  USING (public.is_internal_user(auth.uid()))
  WITH CHECK (public.is_internal_user(auth.uid()));

CREATE TABLE public.refinery_iterations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_id uuid NOT NULL REFERENCES public.refinery_prompts(id) ON DELETE CASCADE,
  iteration_number integer NOT NULL,
  refinement_dataset_id uuid REFERENCES public.refinery_datasets(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending',
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (prompt_id, iteration_number)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.refinery_iterations TO authenticated;
GRANT ALL ON public.refinery_iterations TO service_role;
ALTER TABLE public.refinery_iterations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Internal users manage refinery iterations"
  ON public.refinery_iterations FOR ALL TO authenticated
  USING (public.is_internal_user(auth.uid()))
  WITH CHECK (public.is_internal_user(auth.uid()));
CREATE TRIGGER update_refinery_iterations_updated_at
  BEFORE UPDATE ON public.refinery_iterations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.refinery_iteration_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  iteration_id uuid NOT NULL REFERENCES public.refinery_iterations(id) ON DELETE CASCADE,
  dataset_id uuid NOT NULL REFERENCES public.refinery_datasets(id) ON DELETE CASCADE,
  f1_score numeric,
  precision_score numeric,
  recall_score numeric,
  diff jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (iteration_id, dataset_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.refinery_iteration_results TO authenticated;
GRANT ALL ON public.refinery_iteration_results TO service_role;
ALTER TABLE public.refinery_iteration_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Internal users manage refinery iteration results"
  ON public.refinery_iteration_results FOR ALL TO authenticated
  USING (public.is_internal_user(auth.uid()))
  WITH CHECK (public.is_internal_user(auth.uid()));
CREATE TRIGGER update_refinery_iteration_results_updated_at
  BEFORE UPDATE ON public.refinery_iteration_results
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();