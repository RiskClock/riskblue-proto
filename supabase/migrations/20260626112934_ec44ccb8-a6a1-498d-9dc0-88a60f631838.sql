CREATE TABLE public.report_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  analysis_request_id uuid REFERENCES public.analysis_requests(id) ON DELETE SET NULL,
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  storage_path text,
  manifest_path text,
  page_count integer,
  file_size bigint,
  error_message text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.report_exports TO authenticated;
GRANT ALL ON public.report_exports TO service_role;

ALTER TABLE public.report_exports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members read export rows"
  ON public.report_exports FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_project_access(project_id));

CREATE POLICY "requester inserts own export"
  ON public.report_exports FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE TRIGGER trg_report_exports_updated
  BEFORE UPDATE ON public.report_exports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_report_exports_project ON public.report_exports(project_id);
CREATE INDEX idx_report_exports_user ON public.report_exports(user_id);