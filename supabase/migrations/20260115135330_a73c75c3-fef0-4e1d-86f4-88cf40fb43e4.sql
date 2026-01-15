-- Create storage bucket for analysis files
INSERT INTO storage.buckets (id, name, public)
VALUES ('drive-analysis-files', 'drive-analysis-files', false);

-- Create analysis_requests table
CREATE TABLE public.analysis_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  drive_folder_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'copying', 'copied', 'processing', 'complete', 'failed')),
  file_count INTEGER DEFAULT 0,
  total_size_bytes BIGINT,
  storage_path TEXT,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create analysis_request_files table
CREATE TABLE public.analysis_request_files (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  analysis_request_id UUID NOT NULL REFERENCES public.analysis_requests(id) ON DELETE CASCADE,
  drive_file_id TEXT NOT NULL,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT,
  relative_path TEXT NOT NULL,
  storage_path TEXT,
  copy_status TEXT NOT NULL DEFAULT 'pending' CHECK (copy_status IN ('pending', 'copied', 'failed')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.analysis_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_request_files ENABLE ROW LEVEL SECURITY;

-- RLS policies for analysis_requests
CREATE POLICY "Users can insert analysis requests for their projects"
ON public.analysis_requests
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM projects
    WHERE projects.id = analysis_requests.project_id
    AND projects.user_id = auth.uid()
  ) OR is_internal_user(auth.uid())
);

CREATE POLICY "Users can view analysis requests for their projects"
ON public.analysis_requests
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM projects
    WHERE projects.id = analysis_requests.project_id
    AND projects.user_id = auth.uid()
  ) OR is_internal_user(auth.uid())
);

CREATE POLICY "Internal users can update analysis requests"
ON public.analysis_requests
FOR UPDATE
USING (is_internal_user(auth.uid()))
WITH CHECK (is_internal_user(auth.uid()));

-- RLS policies for analysis_request_files
CREATE POLICY "Users can insert files for their analysis requests"
ON public.analysis_request_files
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM analysis_requests ar
    JOIN projects p ON p.id = ar.project_id
    WHERE ar.id = analysis_request_files.analysis_request_id
    AND (p.user_id = auth.uid() OR is_internal_user(auth.uid()))
  )
);

CREATE POLICY "Users can view files for their analysis requests"
ON public.analysis_request_files
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM analysis_requests ar
    JOIN projects p ON p.id = ar.project_id
    WHERE ar.id = analysis_request_files.analysis_request_id
    AND (p.user_id = auth.uid() OR is_internal_user(auth.uid()))
  )
);

CREATE POLICY "Internal users can update analysis request files"
ON public.analysis_request_files
FOR UPDATE
USING (is_internal_user(auth.uid()))
WITH CHECK (is_internal_user(auth.uid()));

-- Storage policies for drive-analysis-files bucket
CREATE POLICY "Project members can upload analysis files"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'drive-analysis-files' AND
  (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id::text = (storage.foldername(name))[1]
      AND projects.user_id = auth.uid()
    ) OR is_internal_user(auth.uid())
  )
);

CREATE POLICY "Project members and internal users can view analysis files"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'drive-analysis-files' AND
  (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id::text = (storage.foldername(name))[1]
      AND projects.user_id = auth.uid()
    ) OR is_internal_user(auth.uid())
  )
);

CREATE POLICY "Internal users can delete analysis files"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'drive-analysis-files' AND
  is_internal_user(auth.uid())
);

-- Add trigger for updated_at
CREATE TRIGGER update_analysis_requests_updated_at
BEFORE UPDATE ON public.analysis_requests
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();