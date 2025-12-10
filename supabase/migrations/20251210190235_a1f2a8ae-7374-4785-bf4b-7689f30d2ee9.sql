-- Fix RLS policies to be PERMISSIVE instead of RESTRICTIVE
-- Drop and recreate the INSERT policy for project_analysis_items

DROP POLICY IF EXISTS "Users can insert analysis items for their projects" ON public.project_analysis_items;

CREATE POLICY "Users can insert analysis items for their projects" 
ON public.project_analysis_items 
FOR INSERT 
TO authenticated
WITH CHECK (EXISTS ( SELECT 1
   FROM projects
  WHERE ((projects.id = project_analysis_items.project_id) AND (projects.user_id = auth.uid()))));

-- Also fix UPDATE and DELETE to be permissive
DROP POLICY IF EXISTS "Users can update analysis items for their projects" ON public.project_analysis_items;

CREATE POLICY "Users can update analysis items for their projects" 
ON public.project_analysis_items 
FOR UPDATE
TO authenticated
USING (EXISTS ( SELECT 1
   FROM projects
  WHERE ((projects.id = project_analysis_items.project_id) AND (projects.user_id = auth.uid()))));

DROP POLICY IF EXISTS "Users can delete analysis items for their projects" ON public.project_analysis_items;

CREATE POLICY "Users can delete analysis items for their projects" 
ON public.project_analysis_items 
FOR DELETE
TO authenticated
USING (EXISTS ( SELECT 1
   FROM projects
  WHERE ((projects.id = project_analysis_items.project_id) AND (projects.user_id = auth.uid()))));

DROP POLICY IF EXISTS "Users can view analysis items for their projects" ON public.project_analysis_items;

CREATE POLICY "Users can view analysis items for their projects" 
ON public.project_analysis_items 
FOR SELECT
TO authenticated
USING (EXISTS ( SELECT 1
   FROM projects
  WHERE ((projects.id = project_analysis_items.project_id) AND (projects.user_id = auth.uid()))));