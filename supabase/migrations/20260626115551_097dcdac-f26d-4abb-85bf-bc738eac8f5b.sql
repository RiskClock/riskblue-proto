CREATE POLICY "requester updates own export" ON public.report_exports FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Repair the stuck row from earlier (DOCX is already in storage).
UPDATE public.report_exports
SET status = 'ready',
    storage_path = 'dc72cf37-2905-44f6-ab0e-c87f5d51d42f/threat-reports/82d75d40-f51e-445d-afee-129454113e8d/threat-report.docx',
    file_size = 8940922,
    expires_at = now() + interval '30 days'
WHERE id = '82d75d40-f51e-445d-afee-129454113e8d' AND status = 'processing';