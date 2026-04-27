
CREATE TABLE public.user_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX user_tags_name_lower_idx ON public.user_tags (lower(name));

ALTER TABLE public.user_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Internal users can view tags"
ON public.user_tags FOR SELECT
USING (public.is_internal_user(auth.uid()));

CREATE POLICY "Internal users can create tags"
ON public.user_tags FOR INSERT
WITH CHECK (public.is_internal_user(auth.uid()));

CREATE POLICY "Internal users can update tags"
ON public.user_tags FOR UPDATE
USING (public.is_internal_user(auth.uid()))
WITH CHECK (public.is_internal_user(auth.uid()));

CREATE TABLE public.user_tag_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  tag_id uuid NOT NULL REFERENCES public.user_tags(id) ON DELETE CASCADE,
  assigned_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, tag_id)
);
CREATE INDEX user_tag_assignments_user_id_idx ON public.user_tag_assignments(user_id);
CREATE INDEX user_tag_assignments_tag_id_idx ON public.user_tag_assignments(tag_id);

ALTER TABLE public.user_tag_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Internal users can view tag assignments"
ON public.user_tag_assignments FOR SELECT
USING (public.is_internal_user(auth.uid()));

CREATE POLICY "Internal users can create tag assignments"
ON public.user_tag_assignments FOR INSERT
WITH CHECK (public.is_internal_user(auth.uid()));

CREATE POLICY "Internal users can delete tag assignments"
ON public.user_tag_assignments FOR DELETE
USING (public.is_internal_user(auth.uid()));
