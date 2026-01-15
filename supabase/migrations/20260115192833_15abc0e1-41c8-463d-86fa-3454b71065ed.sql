-- Create access_requests table for prospective users
CREATE TABLE public.access_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  work_email TEXT NOT NULL,
  company_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  status TEXT DEFAULT 'pending'
);

-- Enable RLS
ALTER TABLE public.access_requests ENABLE ROW LEVEL SECURITY;

-- Allow anyone (including anonymous) to submit access requests
CREATE POLICY "Anyone can submit access requests"
  ON public.access_requests FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Only internal users can view access requests
CREATE POLICY "Internal users can view access requests"
  ON public.access_requests FOR SELECT
  TO authenticated
  USING (public.is_internal_user(auth.uid()));