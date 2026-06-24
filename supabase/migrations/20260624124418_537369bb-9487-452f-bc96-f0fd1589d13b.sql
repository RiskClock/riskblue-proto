
DROP TRIGGER IF EXISTS trg_cleanup_request_storage ON public.analysis_requests;
DROP TRIGGER IF EXISTS cleanup_request_storage_trigger ON public.analysis_requests;
DROP FUNCTION IF EXISTS public.cleanup_request_storage();
