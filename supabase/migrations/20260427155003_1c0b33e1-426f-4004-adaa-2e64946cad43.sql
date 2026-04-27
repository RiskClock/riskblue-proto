-- Drop the overly permissive public SELECT policy
DROP POLICY IF EXISTS "Anyone can view awp class prompts" ON public.awp_class_prompts;

-- Replace with an authenticated-only SELECT policy
CREATE POLICY "Authenticated users can view awp class prompts"
ON public.awp_class_prompts
FOR SELECT
TO authenticated
USING (true);