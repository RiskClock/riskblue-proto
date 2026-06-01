CREATE TABLE public.drawing_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_request_id uuid NOT NULL,
  file_id uuid NOT NULL,
  sheet_id uuid,
  awp_class_name text NOT NULL,
  nx numeric NOT NULL,
  ny numeric NOT NULL,
  page_index integer NOT NULL DEFAULT 1,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.drawing_instances TO authenticated;
GRANT ALL ON public.drawing_instances TO service_role;

ALTER TABLE public.drawing_instances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Internal users can manage drawing instances"
ON public.drawing_instances FOR ALL TO authenticated
USING (is_internal_user(auth.uid()))
WITH CHECK (is_internal_user(auth.uid()));

CREATE POLICY "Project members can view drawing instances"
ON public.drawing_instances FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM analysis_requests ar
  JOIN projects p ON p.id = ar.project_id
  WHERE ar.id = drawing_instances.analysis_request_id
    AND (p.user_id = auth.uid() OR is_project_member(auth.uid(), p.id))
));

CREATE INDEX idx_drawing_instances_request_file_class
  ON public.drawing_instances (analysis_request_id, file_id, awp_class_name);
CREATE INDEX idx_drawing_instances_sheet
  ON public.drawing_instances (sheet_id);