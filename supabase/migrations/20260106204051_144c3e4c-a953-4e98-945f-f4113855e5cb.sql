-- Allow internal users to view all profiles for the "Created By" feature
CREATE POLICY "Internal users can view all profiles"
ON public.profiles
FOR SELECT
USING (is_internal_user(auth.uid()));