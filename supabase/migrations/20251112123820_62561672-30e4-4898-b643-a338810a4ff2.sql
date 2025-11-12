-- Create table for project collaborators/invited users
CREATE TABLE public.project_collaborators (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  company TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(project_id, email)
);

-- Enable RLS
ALTER TABLE public.project_collaborators ENABLE ROW LEVEL SECURITY;

-- Users can view collaborators for their own projects
CREATE POLICY "Users can view collaborators for their projects"
ON public.project_collaborators
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.projects
    WHERE projects.id = project_collaborators.project_id
    AND projects.user_id = auth.uid()
  )
);

-- Users can insert collaborators for their own projects
CREATE POLICY "Users can insert collaborators for their projects"
ON public.project_collaborators
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects
    WHERE projects.id = project_collaborators.project_id
    AND projects.user_id = auth.uid()
  )
);

-- Users can delete collaborators for their own projects
CREATE POLICY "Users can delete collaborators for their projects"
ON public.project_collaborators
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.projects
    WHERE projects.id = project_collaborators.project_id
    AND projects.user_id = auth.uid()
  )
);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_project_collaborators_updated_at
BEFORE UPDATE ON public.project_collaborators
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create table for company proposals with system breakdowns
CREATE TABLE public.company_proposals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company TEXT NOT NULL,
  system_name TEXT NOT NULL,
  system_cost NUMERIC NOT NULL DEFAULT 0,
  details TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(project_id, company, system_name)
);

-- Enable RLS
ALTER TABLE public.company_proposals ENABLE ROW LEVEL SECURITY;

-- Users can view proposals for their own projects
CREATE POLICY "Users can view proposals for their projects"
ON public.company_proposals
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.projects
    WHERE projects.id = company_proposals.project_id
    AND projects.user_id = auth.uid()
  )
);

-- Users can insert proposals for their own projects
CREATE POLICY "Users can insert proposals for their projects"
ON public.company_proposals
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects
    WHERE projects.id = company_proposals.project_id
    AND projects.user_id = auth.uid()
  )
);

-- Users can update proposals for their own projects
CREATE POLICY "Users can update proposals for their projects"
ON public.company_proposals
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.projects
    WHERE projects.id = company_proposals.project_id
    AND projects.user_id = auth.uid()
  )
);

-- Users can delete proposals for their own projects
CREATE POLICY "Users can delete proposals for their projects"
ON public.company_proposals
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.projects
    WHERE projects.id = company_proposals.project_id
    AND projects.user_id = auth.uid()
  )
);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_company_proposals_updated_at
BEFORE UPDATE ON public.company_proposals
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();