
REVOKE ALL ON FUNCTION public.claim_next_analysis_jobs(TEXT, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.try_lock_analysis_finalize(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_next_analysis_jobs(TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.try_lock_analysis_finalize(UUID) TO service_role;
