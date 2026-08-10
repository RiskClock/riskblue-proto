CREATE TABLE public.wade_chat_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  content text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_wade_chat_messages_project ON public.wade_chat_messages (project_id, created_at);

GRANT SELECT, INSERT, DELETE ON public.wade_chat_messages TO authenticated;
GRANT ALL ON public.wade_chat_messages TO service_role;

ALTER TABLE public.wade_chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project members can view Wade chat"
ON public.wade_chat_messages FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = wade_chat_messages.project_id
      AND (p.user_id = auth.uid() OR public.is_internal_user(auth.uid()) OR public.is_project_member(auth.uid(), p.id))
  )
);

CREATE POLICY "Project members can add Wade chat"
ON public.wade_chat_messages FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = wade_chat_messages.project_id
      AND (p.user_id = auth.uid() OR public.is_internal_user(auth.uid()) OR public.is_project_member(auth.uid(), p.id))
  )
);

CREATE POLICY "Project members can clear Wade chat"
ON public.wade_chat_messages FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = wade_chat_messages.project_id
      AND (p.user_id = auth.uid() OR public.is_internal_user(auth.uid()) OR public.is_project_member(auth.uid(), p.id))
  )
);