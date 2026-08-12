CREATE TABLE public.refinery_prompts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  prompt_key text NOT NULL UNIQUE,
  class_name text NOT NULL,
  class_category text,
  status text NOT NULL DEFAULT 'draft',
  f1_score numeric,
  target_model text,
  prompt_text text,
  last_refined_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT refinery_prompts_status_check CHECK (status IN ('draft','production','archived'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.refinery_prompts TO authenticated;
GRANT ALL ON public.refinery_prompts TO service_role;

ALTER TABLE public.refinery_prompts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Internal users manage refinery prompts"
ON public.refinery_prompts FOR ALL TO authenticated
USING (public.is_internal_user(auth.uid()))
WITH CHECK (public.is_internal_user(auth.uid()));

CREATE TRIGGER update_refinery_prompts_updated_at
BEFORE UPDATE ON public.refinery_prompts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_refinery_prompts_class ON public.refinery_prompts (class_name);