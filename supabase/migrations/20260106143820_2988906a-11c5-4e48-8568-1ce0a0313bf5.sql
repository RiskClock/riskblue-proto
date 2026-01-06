-- Phase 4: Allow @riskclock.com users to access all projects

-- Create a helper function to check if user has riskclock email
CREATE OR REPLACE FUNCTION public.is_internal_user(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (auth.jwt()->>'email') LIKE '%@riskclock.com'
$$;

-- Update projects policies
DROP POLICY IF EXISTS "Users can view their own projects" ON public.projects;
CREATE POLICY "Users can view their own projects or internal users can view all"
ON public.projects
FOR SELECT
USING (auth.uid() = user_id OR is_internal_user(auth.uid()));

DROP POLICY IF EXISTS "Users can update their own projects" ON public.projects;
CREATE POLICY "Users can update their own projects or internal users can update all"
ON public.projects
FOR UPDATE
USING (auth.uid() = user_id OR is_internal_user(auth.uid()));

-- Update project_analysis_items policies
DROP POLICY IF EXISTS "Users can view analysis items for their projects" ON public.project_analysis_items;
CREATE POLICY "Users can view analysis items for their projects or internal"
ON public.project_analysis_items
FOR SELECT
USING (
  EXISTS (SELECT 1 FROM projects WHERE projects.id = project_analysis_items.project_id AND projects.user_id = auth.uid())
  OR is_internal_user(auth.uid())
);

DROP POLICY IF EXISTS "Users can insert analysis items for their projects" ON public.project_analysis_items;
CREATE POLICY "Users can insert analysis items for their projects or internal"
ON public.project_analysis_items
FOR INSERT
WITH CHECK (
  EXISTS (SELECT 1 FROM projects WHERE projects.id = project_analysis_items.project_id AND projects.user_id = auth.uid())
  OR is_internal_user(auth.uid())
);

DROP POLICY IF EXISTS "Users can update analysis items for their projects" ON public.project_analysis_items;
CREATE POLICY "Users can update analysis items for their projects or internal"
ON public.project_analysis_items
FOR UPDATE
USING (
  EXISTS (SELECT 1 FROM projects WHERE projects.id = project_analysis_items.project_id AND projects.user_id = auth.uid())
  OR is_internal_user(auth.uid())
);

DROP POLICY IF EXISTS "Users can delete analysis items for their projects" ON public.project_analysis_items;
CREATE POLICY "Users can delete analysis items for their projects or internal"
ON public.project_analysis_items
FOR DELETE
USING (
  EXISTS (SELECT 1 FROM projects WHERE projects.id = project_analysis_items.project_id AND projects.user_id = auth.uid())
  OR is_internal_user(auth.uid())
);

-- Update project_collaborators policies
DROP POLICY IF EXISTS "Users can view collaborators for their projects" ON public.project_collaborators;
CREATE POLICY "Users can view collaborators for their projects or internal"
ON public.project_collaborators
FOR SELECT
USING (
  EXISTS (SELECT 1 FROM projects WHERE projects.id = project_collaborators.project_id AND projects.user_id = auth.uid())
  OR is_internal_user(auth.uid())
);

DROP POLICY IF EXISTS "Users can insert collaborators for their projects" ON public.project_collaborators;
CREATE POLICY "Users can insert collaborators for their projects or internal"
ON public.project_collaborators
FOR INSERT
WITH CHECK (
  EXISTS (SELECT 1 FROM projects WHERE projects.id = project_collaborators.project_id AND projects.user_id = auth.uid())
  OR is_internal_user(auth.uid())
);

DROP POLICY IF EXISTS "Users can delete collaborators for their projects" ON public.project_collaborators;
CREATE POLICY "Users can delete collaborators for their projects or internal"
ON public.project_collaborators
FOR DELETE
USING (
  EXISTS (SELECT 1 FROM projects WHERE projects.id = project_collaborators.project_id AND projects.user_id = auth.uid())
  OR is_internal_user(auth.uid())
);

-- Update company_proposals policies
DROP POLICY IF EXISTS "Users can view proposals for their projects" ON public.company_proposals;
CREATE POLICY "Users can view proposals for their projects or internal"
ON public.company_proposals
FOR SELECT
USING (
  EXISTS (SELECT 1 FROM projects WHERE projects.id = company_proposals.project_id AND projects.user_id = auth.uid())
  OR is_internal_user(auth.uid())
);

DROP POLICY IF EXISTS "Users can insert proposals for their projects" ON public.company_proposals;
CREATE POLICY "Users can insert proposals for their projects or internal"
ON public.company_proposals
FOR INSERT
WITH CHECK (
  EXISTS (SELECT 1 FROM projects WHERE projects.id = company_proposals.project_id AND projects.user_id = auth.uid())
  OR is_internal_user(auth.uid())
);

DROP POLICY IF EXISTS "Users can update proposals for their projects" ON public.company_proposals;
CREATE POLICY "Users can update proposals for their projects or internal"
ON public.company_proposals
FOR UPDATE
USING (
  EXISTS (SELECT 1 FROM projects WHERE projects.id = company_proposals.project_id AND projects.user_id = auth.uid())
  OR is_internal_user(auth.uid())
);

DROP POLICY IF EXISTS "Users can delete proposals for their projects" ON public.company_proposals;
CREATE POLICY "Users can delete proposals for their projects or internal"
ON public.company_proposals
FOR DELETE
USING (
  EXISTS (SELECT 1 FROM projects WHERE projects.id = company_proposals.project_id AND projects.user_id = auth.uid())
  OR is_internal_user(auth.uid())
);

-- Update control_comments policies
DROP POLICY IF EXISTS "Users can view comments for their projects" ON public.control_comments;
CREATE POLICY "Users can view comments for their projects or internal"
ON public.control_comments
FOR SELECT
USING (
  EXISTS (SELECT 1 FROM projects WHERE projects.id = control_comments.project_id AND projects.user_id = auth.uid())
  OR is_internal_user(auth.uid())
);

DROP POLICY IF EXISTS "Users can insert comments for their projects" ON public.control_comments;
CREATE POLICY "Users can insert comments for their projects or internal"
ON public.control_comments
FOR INSERT
WITH CHECK (
  EXISTS (SELECT 1 FROM projects WHERE projects.id = control_comments.project_id AND projects.user_id = auth.uid())
  OR is_internal_user(auth.uid())
);

-- Update custom_critical_assets policies
DROP POLICY IF EXISTS "Users can view custom assets for their projects" ON public.custom_critical_assets;
CREATE POLICY "Users can view custom assets for their projects or internal"
ON public.custom_critical_assets
FOR SELECT
USING (
  EXISTS (SELECT 1 FROM projects WHERE projects.id = custom_critical_assets.project_id AND projects.user_id = auth.uid())
  OR is_internal_user(auth.uid())
);

DROP POLICY IF EXISTS "Users can insert custom assets for their projects" ON public.custom_critical_assets;
CREATE POLICY "Users can insert custom assets for their projects or internal"
ON public.custom_critical_assets
FOR INSERT
WITH CHECK (
  EXISTS (SELECT 1 FROM projects WHERE projects.id = custom_critical_assets.project_id AND projects.user_id = auth.uid())
  OR is_internal_user(auth.uid())
);

DROP POLICY IF EXISTS "Users can delete custom assets for their projects" ON public.custom_critical_assets;
CREATE POLICY "Users can delete custom assets for their projects or internal"
ON public.custom_critical_assets
FOR DELETE
USING (
  EXISTS (SELECT 1 FROM projects WHERE projects.id = custom_critical_assets.project_id AND projects.user_id = auth.uid())
  OR is_internal_user(auth.uid())
);

-- Update custom_water_systems policies
DROP POLICY IF EXISTS "Users can view custom systems for their projects" ON public.custom_water_systems;
CREATE POLICY "Users can view custom systems for their projects or internal"
ON public.custom_water_systems
FOR SELECT
USING (
  EXISTS (SELECT 1 FROM projects WHERE projects.id = custom_water_systems.project_id AND projects.user_id = auth.uid())
  OR is_internal_user(auth.uid())
);

DROP POLICY IF EXISTS "Users can insert custom systems for their projects" ON public.custom_water_systems;
CREATE POLICY "Users can insert custom systems for their projects or internal"
ON public.custom_water_systems
FOR INSERT
WITH CHECK (
  EXISTS (SELECT 1 FROM projects WHERE projects.id = custom_water_systems.project_id AND projects.user_id = auth.uid())
  OR is_internal_user(auth.uid())
);

DROP POLICY IF EXISTS "Users can delete custom systems for their projects" ON public.custom_water_systems;
CREATE POLICY "Users can delete custom systems for their projects or internal"
ON public.custom_water_systems
FOR DELETE
USING (
  EXISTS (SELECT 1 FROM projects WHERE projects.id = custom_water_systems.project_id AND projects.user_id = auth.uid())
  OR is_internal_user(auth.uid())
);

-- Update proposals policies
DROP POLICY IF EXISTS "Users can view proposals for their projects" ON public.proposals;
CREATE POLICY "Users can view proposals for their projects or internal"
ON public.proposals
FOR SELECT
USING (
  EXISTS (SELECT 1 FROM projects WHERE projects.id = proposals.project_id AND projects.user_id = auth.uid())
  OR is_internal_user(auth.uid())
);

DROP POLICY IF EXISTS "Users can insert proposals for their projects" ON public.proposals;
CREATE POLICY "Users can insert proposals for their projects or internal"
ON public.proposals
FOR INSERT
WITH CHECK (
  EXISTS (SELECT 1 FROM projects WHERE projects.id = proposals.project_id AND projects.user_id = auth.uid())
  OR is_internal_user(auth.uid())
);

DROP POLICY IF EXISTS "Users can update proposals for their projects" ON public.proposals;
CREATE POLICY "Users can update proposals for their projects or internal"
ON public.proposals
FOR UPDATE
USING (
  EXISTS (SELECT 1 FROM projects WHERE projects.id = proposals.project_id AND projects.user_id = auth.uid())
  OR is_internal_user(auth.uid())
);

DROP POLICY IF EXISTS "Users can delete proposals for their projects" ON public.proposals;
CREATE POLICY "Users can delete proposals for their projects or internal"
ON public.proposals
FOR DELETE
USING (
  EXISTS (SELECT 1 FROM projects WHERE projects.id = proposals.project_id AND projects.user_id = auth.uid())
  OR is_internal_user(auth.uid())
);