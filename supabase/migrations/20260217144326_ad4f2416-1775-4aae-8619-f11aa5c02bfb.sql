
-- Create analysis_results table
CREATE TABLE public.analysis_results (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  analysis_request_id uuid NOT NULL REFERENCES public.analysis_requests(id) ON DELETE CASCADE,
  file_id uuid NOT NULL REFERENCES public.analysis_request_files(id) ON DELETE CASCADE,
  awp_class_name text NOT NULL,
  result_text text,
  status text NOT NULL DEFAULT 'pending',
  error_message text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.analysis_results ENABLE ROW LEVEL SECURITY;

-- Internal users can do everything
CREATE POLICY "Internal users can manage analysis results"
ON public.analysis_results
FOR ALL
USING (is_internal_user(auth.uid()))
WITH CHECK (is_internal_user(auth.uid()));

-- Project owners can read
CREATE POLICY "Project owners can view analysis results"
ON public.analysis_results
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM analysis_requests ar
    JOIN projects p ON p.id = ar.project_id
    WHERE ar.id = analysis_results.analysis_request_id
    AND p.user_id = auth.uid()
  )
);

-- Trigger for updated_at
CREATE TRIGGER update_analysis_results_updated_at
BEFORE UPDATE ON public.analysis_results
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
