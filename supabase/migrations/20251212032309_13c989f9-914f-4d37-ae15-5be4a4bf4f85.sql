-- Add new columns to critical_assets
ALTER TABLE public.critical_assets 
ADD COLUMN IF NOT EXISTS risk_tolerance integer DEFAULT 3,
ADD COLUMN IF NOT EXISTS start_date_formula text,
ADD COLUMN IF NOT EXISTS end_date_formula text;

ALTER TABLE public.critical_assets ALTER COLUMN duration DROP NOT NULL;

-- Add new columns to water_systems
ALTER TABLE public.water_systems 
ADD COLUMN IF NOT EXISTS risk_tolerance integer DEFAULT 3,
ADD COLUMN IF NOT EXISTS start_date_formula text,
ADD COLUMN IF NOT EXISTS end_date_formula text;

ALTER TABLE public.water_systems ALTER COLUMN duration DROP NOT NULL;

-- Create processes table
CREATE TABLE public.processes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  risk_tolerance integer NOT NULL DEFAULT 3,
  threat text NOT NULL,
  risk_level text NOT NULL,
  risk_level_points integer NOT NULL DEFAULT 0,
  cost text NOT NULL,
  duration text,
  image_url text NOT NULL DEFAULT '',
  start_date_formula text,
  end_date_formula text,
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.processes ENABLE ROW LEVEL SECURITY;

-- RLS policies for processes (same pattern as other reference tables)
CREATE POLICY "Admins can manage processes"
ON public.processes FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Anyone can view active processes"
ON public.processes FOR SELECT
USING (true);