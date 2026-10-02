CREATE TABLE public.risk_radar_run_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id uuid NOT NULL REFERENCES public.analysis_request_files(id) ON DELETE CASCADE,
  analysis_request_id uuid NOT NULL REFERENCES public.analysis_requests(id) ON DELETE CASCADE,
  class_name text NOT NULL,
  page_numbers integer[] NOT NULL DEFAULT '{}',
  model text,
  prompt_text text,
  result_text text,
  error text,
  tokens jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.risk_radar_run_history TO authenticated;
GRANT ALL ON public.risk_radar_run_history TO service_role;
ALTER TABLE public.risk_radar_run_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "System admins can view Risk Radar history" ON public.risk_radar_run_history FOR SELECT TO authenticated USING (public.is_system_admin(auth.uid()));
CREATE INDEX risk_radar_run_history_file_created_idx ON public.risk_radar_run_history(file_id, created_at DESC);
CREATE TRIGGER risk_radar_run_history_updated_at BEFORE UPDATE ON public.risk_radar_run_history FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();