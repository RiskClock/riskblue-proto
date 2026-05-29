-- Workbench: global selection of asset/water-system columns shared by internal users
CREATE TABLE public.workbench_column_preferences (
  id text PRIMARY KEY DEFAULT 'global',
  awp_class_names text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

GRANT SELECT, INSERT, UPDATE ON public.workbench_column_preferences TO authenticated;
GRANT ALL ON public.workbench_column_preferences TO service_role;

ALTER TABLE public.workbench_column_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Internal users can view workbench column prefs"
ON public.workbench_column_preferences
FOR SELECT TO authenticated
USING (public.is_internal_user(auth.uid()));

CREATE POLICY "Internal users can insert workbench column prefs"
ON public.workbench_column_preferences
FOR INSERT TO authenticated
WITH CHECK (public.is_internal_user(auth.uid()));

CREATE POLICY "Internal users can update workbench column prefs"
ON public.workbench_column_preferences
FOR UPDATE TO authenticated
USING (public.is_internal_user(auth.uid()))
WITH CHECK (public.is_internal_user(auth.uid()));

INSERT INTO public.workbench_column_preferences (id, awp_class_names) VALUES ('global', '{}')
ON CONFLICT (id) DO NOTHING;