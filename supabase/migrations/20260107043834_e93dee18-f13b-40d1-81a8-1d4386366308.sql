-- Add UPDATE policies for internal users on AWP configuration tables

-- Critical Assets: Allow internal users to update
CREATE POLICY "Internal users can update critical assets"
ON public.critical_assets
FOR UPDATE
USING (is_internal_user(auth.uid()))
WITH CHECK (is_internal_user(auth.uid()));

-- Water Systems: Allow internal users to update
CREATE POLICY "Internal users can update water systems"
ON public.water_systems
FOR UPDATE
USING (is_internal_user(auth.uid()))
WITH CHECK (is_internal_user(auth.uid()));

-- Processes: Allow internal users to update
CREATE POLICY "Internal users can update processes"
ON public.processes
FOR UPDATE
USING (is_internal_user(auth.uid()))
WITH CHECK (is_internal_user(auth.uid()));