
-- Create analysis_triage_results table
CREATE TABLE public.analysis_triage_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_request_id uuid NOT NULL REFERENCES public.analysis_requests(id) ON DELETE CASCADE,
  file_id uuid NOT NULL REFERENCES public.analysis_request_files(id) ON DELETE CASCADE,
  awp_class_name text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  score integer,
  reason text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (analysis_request_id, file_id, awp_class_name)
);

-- Enable RLS
ALTER TABLE public.analysis_triage_results ENABLE ROW LEVEL SECURITY;

-- Internal users can do everything
CREATE POLICY "Internal users can manage triage results"
ON public.analysis_triage_results
FOR ALL
TO public
USING (is_internal_user(auth.uid()))
WITH CHECK (is_internal_user(auth.uid()));

-- Project owners can view triage results
CREATE POLICY "Project owners can view triage results"
ON public.analysis_triage_results
FOR SELECT
TO public
USING (
  EXISTS (
    SELECT 1
    FROM analysis_requests ar
    JOIN projects p ON p.id = ar.project_id
    WHERE ar.id = analysis_triage_results.analysis_request_id
      AND p.user_id = auth.uid()
  )
);

-- Add updated_at trigger
CREATE TRIGGER update_analysis_triage_results_updated_at
  BEFORE UPDATE ON public.analysis_triage_results
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Add extracted_text column to analysis_request_files
ALTER TABLE public.analysis_request_files ADD COLUMN extracted_text text;
