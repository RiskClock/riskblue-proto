ALTER TABLE public.analysis_triage_results REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.analysis_triage_results;