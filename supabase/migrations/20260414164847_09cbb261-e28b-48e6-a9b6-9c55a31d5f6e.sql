ALTER TABLE public.analysis_requests
  ADD COLUMN pipeline_phase text DEFAULT NULL,
  ADD COLUMN pipeline_progress_done integer NOT NULL DEFAULT 0,
  ADD COLUMN pipeline_progress_total integer NOT NULL DEFAULT 0,
  ADD COLUMN pipeline_stop_requested boolean NOT NULL DEFAULT false;