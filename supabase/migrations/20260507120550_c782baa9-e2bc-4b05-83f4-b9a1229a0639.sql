-- Add accepted_pages provenance/debug column for Phase 3 file-level analyze jobs.
-- This is metadata only (not used as a focus hint in the model prompt). It records
-- which page numbers triage flagged so we can later evaluate whether to switch to
-- a reduced-page packaging strategy.
ALTER TABLE public.analysis_pipeline_jobs
  ADD COLUMN IF NOT EXISTS accepted_pages integer[] NULL;

COMMENT ON COLUMN public.analysis_pipeline_jobs.accepted_pages IS
  'For sheet-mode analyze jobs (sheet_id IS NULL, file-level): the 1-based PDF page numbers that triage accepted for this (parent_file, awp_class). Provenance/debug only — analyze-drawings sees the full parent PDF.';