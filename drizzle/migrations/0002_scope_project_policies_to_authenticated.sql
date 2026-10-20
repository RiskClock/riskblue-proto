ALTER POLICY "Users can view projects they have access to" ON public.projects TO authenticated;
ALTER POLICY "Users can update projects they have access to" ON public.projects TO authenticated;