DROP POLICY IF EXISTS "Anyone can view active mitigation controls" ON public.mitigation_controls;
CREATE POLICY "Signed-in users can view mitigation controls" ON public.mitigation_controls FOR SELECT TO authenticated USING ((select auth.uid()) IS NOT NULL);
DROP POLICY IF EXISTS "Anyone can view riskred controls" ON public.riskred_controls;
CREATE POLICY "Signed-in users can view riskred controls" ON public.riskred_controls FOR SELECT TO authenticated USING ((select auth.uid()) IS NOT NULL);
DROP POLICY IF EXISTS "Anyone can view riskred asp" ON public.riskred_asp;
CREATE POLICY "Signed-in users can view riskred asp" ON public.riskred_asp FOR SELECT TO authenticated USING ((select auth.uid()) IS NOT NULL);
DROP POLICY IF EXISTS "Anyone can view active processes" ON public.processes;
CREATE POLICY "Signed-in users can view processes" ON public.processes FOR SELECT TO authenticated USING ((select auth.uid()) IS NOT NULL);
DROP POLICY IF EXISTS "Anyone can view active water systems" ON public.water_systems;
CREATE POLICY "Signed-in users can view water systems" ON public.water_systems FOR SELECT TO authenticated USING ((select auth.uid()) IS NOT NULL);
DROP POLICY IF EXISTS "Anyone can view active critical assets" ON public.critical_assets;
CREATE POLICY "Signed-in users can view critical assets" ON public.critical_assets FOR SELECT TO authenticated USING ((select auth.uid()) IS NOT NULL);
DROP POLICY IF EXISTS "Authenticated can view company logos" ON public.company_logos;
CREATE POLICY "Signed-in users can view company logos" ON public.company_logos FOR SELECT TO authenticated USING ((select auth.uid()) IS NOT NULL);
DROP POLICY IF EXISTS "Anyone can submit access requests" ON public.access_requests;
CREATE POLICY "Anyone can submit valid pending access requests" ON public.access_requests FOR INSERT TO anon, authenticated
WITH CHECK (
  status = 'pending'
  AND work_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(work_email) <= 255
  AND (full_name IS NULL OR length(full_name) <= 200)
  AND (company_name IS NULL OR length(company_name) <= 200)
  AND (requesting_user_id IS NULL OR requesting_user_id = (select auth.uid()))
);
DROP POLICY IF EXISTS "Signed-in users can upload product images" ON storage.objects;
CREATE POLICY "Company editors can upload product images" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'product-images' AND (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$' AND public.can_manage_tenant_controls((select auth.uid()), ((storage.foldername(name))[1])::uuid));