
-- Add account_type column to profiles
ALTER TABLE public.profiles ADD COLUMN account_type text NOT NULL DEFAULT 'standard';

-- Create wmsv_control_selections table
CREATE TABLE public.wmsv_control_selections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  awp_class_name text NOT NULL,
  category text NOT NULL,
  sub_options jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, awp_class_name)
);

-- Enable RLS
ALTER TABLE public.wmsv_control_selections ENABLE ROW LEVEL SECURITY;

-- Users can manage their own selections
CREATE POLICY "Users can manage their own selections"
  ON public.wmsv_control_selections
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
