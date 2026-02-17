
-- Create awp_class_prompts table
CREATE TABLE public.awp_class_prompts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  awp_class_name text NOT NULL,
  category text NOT NULL,
  drive_file_id text,
  drive_file_name text,
  drive_file_url text,
  drive_file_modified_at timestamptz,
  prompt_content text,
  content_updated_at timestamptz,
  is_stale boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Create drive_watch_channels table
CREATE TABLE public.drive_watch_channels (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  drive_file_id text NOT NULL,
  channel_id text NOT NULL,
  resource_id text,
  expiration timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.awp_class_prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drive_watch_channels ENABLE ROW LEVEL SECURITY;

-- awp_class_prompts RLS: internal users can do everything, others read-only
CREATE POLICY "Internal users can manage awp class prompts"
  ON public.awp_class_prompts FOR ALL
  USING (is_internal_user(auth.uid()))
  WITH CHECK (is_internal_user(auth.uid()));

CREATE POLICY "Anyone can view awp class prompts"
  ON public.awp_class_prompts FOR SELECT
  USING (true);

-- drive_watch_channels RLS: internal users only
CREATE POLICY "Internal users can manage drive watch channels"
  ON public.drive_watch_channels FOR ALL
  USING (is_internal_user(auth.uid()))
  WITH CHECK (is_internal_user(auth.uid()));

-- Trigger for updated_at on awp_class_prompts
CREATE TRIGGER update_awp_class_prompts_updated_at
  BEFORE UPDATE ON public.awp_class_prompts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
