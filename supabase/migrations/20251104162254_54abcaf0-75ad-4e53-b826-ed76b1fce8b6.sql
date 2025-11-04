-- Add status column to projects table
ALTER TABLE public.projects 
ADD COLUMN status text DEFAULT 'draft' CHECK (status IN ('draft', 'completed'));

-- Create proposals table
CREATE TABLE public.proposals (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company_name text NOT NULL,
  contact_email text NOT NULL,
  contact_phone text,
  proposed_cost numeric NOT NULL,
  proposal_details text,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  submitted_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS on proposals
ALTER TABLE public.proposals ENABLE ROW LEVEL SECURITY;

-- RLS policies for proposals
CREATE POLICY "Users can view proposals for their projects"
ON public.proposals
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.projects
    WHERE projects.id = proposals.project_id
    AND projects.user_id = auth.uid()
  )
);

CREATE POLICY "Users can insert proposals for their projects"
ON public.proposals
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects
    WHERE projects.id = proposals.project_id
    AND projects.user_id = auth.uid()
  )
);

CREATE POLICY "Users can update proposals for their projects"
ON public.proposals
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.projects
    WHERE projects.id = proposals.project_id
    AND projects.user_id = auth.uid()
  )
);

CREATE POLICY "Users can delete proposals for their projects"
ON public.proposals
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.projects
    WHERE projects.id = proposals.project_id
    AND projects.user_id = auth.uid()
  )
);

-- Add trigger for proposals updated_at
CREATE TRIGGER update_proposals_updated_at
BEFORE UPDATE ON public.proposals
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();