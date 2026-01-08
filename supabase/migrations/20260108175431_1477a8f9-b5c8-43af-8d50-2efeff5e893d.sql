-- Task 1: Update water_systems to use singular form
UPDATE public.water_systems 
SET name = 'Sump Pit, Storm Drain & Drainage'
WHERE name = 'Sump Pits, Storm Drains and Drainages';

-- Task 2: Create user activity logging table
CREATE TABLE public.user_activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  action text NOT NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  metadata jsonb DEFAULT '{}',
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Create indexes for efficient querying
CREATE INDEX idx_user_activity_logs_user_id ON public.user_activity_logs(user_id);
CREATE INDEX idx_user_activity_logs_action ON public.user_activity_logs(action);
CREATE INDEX idx_user_activity_logs_created_at ON public.user_activity_logs(created_at DESC);

-- Enable RLS
ALTER TABLE public.user_activity_logs ENABLE ROW LEVEL SECURITY;

-- Users can insert their own activity
CREATE POLICY "Users can insert own activity"
ON public.user_activity_logs FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Internal users can view all activity logs
CREATE POLICY "Internal users can view all activity"
ON public.user_activity_logs FOR SELECT
TO authenticated
USING (public.is_internal_user(auth.uid()));