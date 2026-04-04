CREATE TABLE public.analysis_triage_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_request_id uuid NOT NULL REFERENCES public.analysis_requests(id) ON DELETE CASCADE,
  file_id uuid NOT NULL REFERENCES public.analysis_request_files(id) ON DELETE CASCADE,
  awp_class_name text NOT NULL,
  override_type text NOT NULL CHECK (override_type IN ('include', 'exclude')),
  created_at timestamptz DEFAULT now(),
  UNIQUE (analysis_request_id, file_id, awp_class_name)
);

ALTER TABLE public.analysis_triage_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Internal users can manage triage overrides"
ON public.analysis_triage_overrides FOR ALL TO public
USING (is_internal_user(auth.uid()))
WITH CHECK (is_internal_user(auth.uid()));