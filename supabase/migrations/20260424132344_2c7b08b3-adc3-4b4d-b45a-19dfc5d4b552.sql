-- Allow the user who requested an export to update their own job (progress, completion, cancellation).
CREATE POLICY "Requester can update their export jobs"
ON public.analysis_export_jobs
FOR UPDATE
TO authenticated
USING (requested_by_user_id = auth.uid())
WITH CHECK (requested_by_user_id = auth.uid());

-- Internal users may update any export job (for support/audit).
CREATE POLICY "Internal users can update any export job"
ON public.analysis_export_jobs
FOR UPDATE
TO authenticated
USING (is_internal_user(auth.uid()))
WITH CHECK (is_internal_user(auth.uid()));

-- Drop the existing status check constraint if any, then add one that includes 'cancelled'.
DO $$
DECLARE
  cn text;
BEGIN
  SELECT conname INTO cn
  FROM pg_constraint
  WHERE conrelid = 'public.analysis_export_jobs'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%status%';
  IF cn IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.analysis_export_jobs DROP CONSTRAINT %I', cn);
  END IF;
END$$;

ALTER TABLE public.analysis_export_jobs
  ADD CONSTRAINT analysis_export_jobs_status_check
  CHECK (status IN ('pending', 'processing', 'complete', 'failed', 'cancelled'));

-- Index to quickly check active jobs for a given analysis request.
CREATE INDEX IF NOT EXISTS idx_analysis_export_jobs_request_active
  ON public.analysis_export_jobs (analysis_request_id, status)
  WHERE status IN ('pending', 'processing');