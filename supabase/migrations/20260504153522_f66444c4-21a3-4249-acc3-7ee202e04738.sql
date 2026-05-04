ALTER PUBLICATION supabase_realtime ADD TABLE public.analysis_results;
ALTER TABLE public.analysis_results REPLICA IDENTITY FULL;