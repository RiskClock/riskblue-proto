
-- Add unique constraint for upsert support
CREATE UNIQUE INDEX idx_analysis_results_unique 
ON public.analysis_results (analysis_request_id, file_id, awp_class_name);
