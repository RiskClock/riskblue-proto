-- Create a helper function to check if a user has access to a project via project_user_roles
CREATE OR REPLACE FUNCTION public.has_project_access(project_uuid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.project_user_roles
    WHERE project_id = project_uuid
      AND user_id = auth.uid()
  )
$$;

-- Drop the existing SELECT policy
DROP POLICY IF EXISTS "Users can view their own projects or internal users can view al" ON projects;

-- Create new SELECT policy that includes collaborators
CREATE POLICY "Users can view projects they have access to"
ON projects FOR SELECT
TO authenticated
USING (
  auth.uid() = user_id 
  OR is_internal_user(auth.uid())
  OR has_project_access(id)
);

-- Drop the existing UPDATE policy
DROP POLICY IF EXISTS "Users can update their own projects or internal users can updat" ON projects;

-- Create new UPDATE policy that includes collaborators
CREATE POLICY "Users can update projects they have access to"
ON projects FOR UPDATE
TO authenticated
USING (
  auth.uid() = user_id 
  OR is_internal_user(auth.uid())
  OR has_project_access(id)
);