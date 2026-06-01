CREATE TABLE public.workbench_triage_overrides (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  analysis_request_id uuid NOT NULL,
  file_id uuid NOT NULL,
  awp_class_name text NOT NULL,
  override_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  UNIQUE (analysis_request_id, file_id, awp_class_name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workbench_triage_overrides TO authenticated;
GRANT ALL ON public.workbench_triage_overrides TO service_role;

ALTER TABLE public.workbench_triage_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Internal users manage workbench overrides"
ON public.workbench_triage_overrides
FOR ALL
TO authenticated
USING (is_internal_user(auth.uid()))
WITH CHECK (is_internal_user(auth.uid()));

CREATE INDEX idx_workbench_triage_overrides_request ON public.workbench_triage_overrides (analysis_request_id);
