
-- ============================================================
-- Sheet normalization: schema additions
-- ============================================================

-- 1. analysis_request_sheets: one row per page of a parent PDF
CREATE TABLE public.analysis_request_sheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_request_id uuid NOT NULL REFERENCES public.analysis_requests(id) ON DELETE CASCADE,
  parent_file_id uuid NOT NULL REFERENCES public.analysis_request_files(id) ON DELETE CASCADE,
  page_index int NOT NULL,                  -- 1-based page within parent PDF
  name text NOT NULL,                       -- e.g. "{parent.name} — p12"
  storage_path text,                        -- single-page child PDF path; equals parent path for 1-page parents
  extracted_text text,
  extract_status text NOT NULL DEFAULT 'pending'
    CHECK (extract_status IN ('pending','extracted','failed','skipped')),
  extract_error text,
  openai_file_id text,
  openai_file_status text,
  openai_file_uploaded_at timestamptz,
  openai_file_expires_at timestamptz,

  -- Best-effort metadata (extracted from titleblock text or filename)
  sheet_number text,
  sheet_title text,
  discipline text,
  drawing_type text,
  floor_or_level text,
  metadata_confidence numeric,
  metadata_source text,                     -- 'titleblock_text'|'filename'|'ai_inference'|'unknown'

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Idempotency: re-running split must not duplicate
  UNIQUE (parent_file_id, page_index)
);

CREATE INDEX idx_sheets_request ON public.analysis_request_sheets(analysis_request_id);
CREATE INDEX idx_sheets_parent ON public.analysis_request_sheets(parent_file_id);
CREATE INDEX idx_sheets_extract_status ON public.analysis_request_sheets(extract_status);

ALTER TABLE public.analysis_request_sheets ENABLE ROW LEVEL SECURITY;

-- RLS mirrors analysis_request_files exactly
CREATE POLICY "Users can view sheets for their analysis requests"
  ON public.analysis_request_sheets FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.analysis_requests ar
    JOIN public.projects p ON p.id = ar.project_id
    WHERE ar.id = analysis_request_sheets.analysis_request_id
      AND (p.user_id = auth.uid()
        OR public.is_internal_user(auth.uid())
        OR public.is_project_member(auth.uid(), p.id))
  ));

CREATE POLICY "Users can insert sheets for their analysis requests"
  ON public.analysis_request_sheets FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.analysis_requests ar
    JOIN public.projects p ON p.id = ar.project_id
    WHERE ar.id = analysis_request_sheets.analysis_request_id
      AND (p.user_id = auth.uid()
        OR public.is_internal_user(auth.uid())
        OR public.is_project_member(auth.uid(), p.id))
  ));

CREATE POLICY "Project members can update sheets"
  ON public.analysis_request_sheets FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.analysis_requests ar
    JOIN public.projects p ON p.id = ar.project_id
    WHERE ar.id = analysis_request_sheets.analysis_request_id
      AND (p.user_id = auth.uid() OR public.is_project_member(auth.uid(), p.id))
  ));

CREATE POLICY "Internal users can update sheets"
  ON public.analysis_request_sheets FOR UPDATE
  USING (public.is_internal_user(auth.uid()))
  WITH CHECK (public.is_internal_user(auth.uid()));

CREATE POLICY "Project members can delete sheets"
  ON public.analysis_request_sheets FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.analysis_requests ar
    JOIN public.projects p ON p.id = ar.project_id
    WHERE ar.id = analysis_request_sheets.analysis_request_id
      AND (p.user_id = auth.uid() OR public.is_project_member(auth.uid(), p.id))
  ));

CREATE POLICY "Internal users can delete sheets"
  ON public.analysis_request_sheets FOR DELETE
  USING (public.is_internal_user(auth.uid()));

CREATE TRIGGER trg_sheets_updated_at
  BEFORE UPDATE ON public.analysis_request_sheets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Additive columns on results/triage so they can reference a sheet
ALTER TABLE public.analysis_results
  ADD COLUMN sheet_id uuid REFERENCES public.analysis_request_sheets(id) ON DELETE SET NULL;
CREATE INDEX idx_analysis_results_sheet ON public.analysis_results(sheet_id);

ALTER TABLE public.analysis_triage_results
  ADD COLUMN sheet_id uuid REFERENCES public.analysis_request_sheets(id) ON DELETE SET NULL,
  ADD COLUMN sheet_role text
    CHECK (sheet_role IS NULL OR sheet_role IN ('context_sheet','analysis_sheet','irrelevant'));
CREATE INDEX idx_triage_results_sheet ON public.analysis_triage_results(sheet_id);

-- 3. Parent file: split tracking
ALTER TABLE public.analysis_request_files
  ADD COLUMN expected_page_count int,
  ADD COLUMN split_status text NOT NULL DEFAULT 'pending'
    CHECK (split_status IN ('pending','splitting','split','failed','skipped'));

-- 4. Pipeline jobs: support split_pdf_chunk job kind
ALTER TABLE public.analysis_pipeline_jobs
  ADD COLUMN job_kind text NOT NULL DEFAULT 'analyze'
    CHECK (job_kind IN ('analyze','split_pdf_chunk')),
  ADD COLUMN parent_file_id uuid REFERENCES public.analysis_request_files(id) ON DELETE CASCADE,
  ADD COLUMN page_from int,
  ADD COLUMN page_to int;

CREATE INDEX idx_pipeline_jobs_kind_status ON public.analysis_pipeline_jobs(job_kind, status);

-- 5. Per-request feature flag for staged rollout
ALTER TABLE public.analysis_requests
  ADD COLUMN sheet_normalization_enabled boolean NOT NULL DEFAULT false;
