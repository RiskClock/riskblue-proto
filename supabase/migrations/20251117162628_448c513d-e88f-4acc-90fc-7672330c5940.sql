-- Create table for custom critical assets (project-specific)
CREATE TABLE public.custom_critical_assets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  duration TEXT NOT NULL,
  cost TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create table for custom water systems (project-specific)
CREATE TABLE public.custom_water_systems (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  duration TEXT NOT NULL,
  cost TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create table for control comments/conversations
CREATE TABLE public.control_comments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  control_name TEXT NOT NULL,
  user_name TEXT NOT NULL,
  comment TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.custom_critical_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_water_systems ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.control_comments ENABLE ROW LEVEL SECURITY;

-- RLS policies for custom_critical_assets
CREATE POLICY "Users can view custom assets for their projects"
ON public.custom_critical_assets FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.projects
    WHERE projects.id = custom_critical_assets.project_id
    AND projects.user_id = auth.uid()
  )
);

CREATE POLICY "Users can insert custom assets for their projects"
ON public.custom_critical_assets FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects
    WHERE projects.id = custom_critical_assets.project_id
    AND projects.user_id = auth.uid()
  )
);

CREATE POLICY "Users can delete custom assets for their projects"
ON public.custom_critical_assets FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.projects
    WHERE projects.id = custom_critical_assets.project_id
    AND projects.user_id = auth.uid()
  )
);

-- RLS policies for custom_water_systems
CREATE POLICY "Users can view custom systems for their projects"
ON public.custom_water_systems FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.projects
    WHERE projects.id = custom_water_systems.project_id
    AND projects.user_id = auth.uid()
  )
);

CREATE POLICY "Users can insert custom systems for their projects"
ON public.custom_water_systems FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects
    WHERE projects.id = custom_water_systems.project_id
    AND projects.user_id = auth.uid()
  )
);

CREATE POLICY "Users can delete custom systems for their projects"
ON public.custom_water_systems FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.projects
    WHERE projects.id = custom_water_systems.project_id
    AND projects.user_id = auth.uid()
  )
);

-- RLS policies for control_comments
CREATE POLICY "Users can view comments for their projects"
ON public.control_comments FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.projects
    WHERE projects.id = control_comments.project_id
    AND projects.user_id = auth.uid()
  )
);

CREATE POLICY "Users can insert comments for their projects"
ON public.control_comments FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects
    WHERE projects.id = control_comments.project_id
    AND projects.user_id = auth.uid()
  )
);

-- Triggers for updated_at
CREATE TRIGGER update_custom_critical_assets_updated_at
BEFORE UPDATE ON public.custom_critical_assets
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_custom_water_systems_updated_at
BEFORE UPDATE ON public.custom_water_systems
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();