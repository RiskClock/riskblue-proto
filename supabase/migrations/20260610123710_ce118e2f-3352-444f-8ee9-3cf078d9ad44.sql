
-- 1) Flag on awp_classes — "Can Span Multiple Spaces"
ALTER TABLE public.awp_classes
  ADD COLUMN IF NOT EXISTS can_span_multiple_spaces boolean NOT NULL DEFAULT false;

-- Default-enable for known riser classes
UPDATE public.awp_classes
SET can_span_multiple_spaces = true
WHERE name IN ('Electrical Riser', 'Mechanical Riser')
   OR id_prefix IN ('ERS', 'MRS');

-- 2) annotation_consolidations
CREATE TABLE IF NOT EXISTS public.annotation_consolidations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_request_id uuid NOT NULL REFERENCES public.analysis_requests(id) ON DELETE CASCADE,
  awp_class_name text NOT NULL,
  label text NOT NULL,
  instance_number integer,
  member_annotation_ids uuid[] NOT NULL DEFAULT '{}',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS annotation_consolidations_request_idx
  ON public.annotation_consolidations(analysis_request_id);

CREATE INDEX IF NOT EXISTS annotation_consolidations_class_idx
  ON public.annotation_consolidations(analysis_request_id, awp_class_name);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.annotation_consolidations TO authenticated;
GRANT ALL ON public.annotation_consolidations TO service_role;

ALTER TABLE public.annotation_consolidations ENABLE ROW LEVEL SECURITY;

-- Authenticated users that can already access the parent analysis request
-- (via existing analysis_requests RLS) may manage the consolidation rows.
CREATE POLICY "Authenticated can view consolidations for accessible requests"
  ON public.annotation_consolidations
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.analysis_requests ar
      WHERE ar.id = annotation_consolidations.analysis_request_id
    )
  );

CREATE POLICY "Authenticated can insert consolidations for accessible requests"
  ON public.annotation_consolidations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.analysis_requests ar
      WHERE ar.id = annotation_consolidations.analysis_request_id
    )
  );

CREATE POLICY "Authenticated can update consolidations for accessible requests"
  ON public.annotation_consolidations
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.analysis_requests ar
      WHERE ar.id = annotation_consolidations.analysis_request_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.analysis_requests ar
      WHERE ar.id = annotation_consolidations.analysis_request_id
    )
  );

CREATE POLICY "Authenticated can delete consolidations for accessible requests"
  ON public.annotation_consolidations
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.analysis_requests ar
      WHERE ar.id = annotation_consolidations.analysis_request_id
    )
  );

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_annotation_consolidations_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_touch_annotation_consolidations
  ON public.annotation_consolidations;

CREATE TRIGGER trg_touch_annotation_consolidations
  BEFORE UPDATE ON public.annotation_consolidations
  FOR EACH ROW EXECUTE FUNCTION public.touch_annotation_consolidations_updated_at();
