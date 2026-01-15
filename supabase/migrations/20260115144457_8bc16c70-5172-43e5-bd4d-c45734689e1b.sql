-- Enable realtime for analysis_requests table
ALTER TABLE public.analysis_requests REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.analysis_requests;