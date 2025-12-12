-- Create control pricing tiers table for variable-cost controls
CREATE TABLE public.control_pricing_tiers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  control_name TEXT NOT NULL,
  tier_type TEXT NOT NULL, -- 'diameter' or 'room_size'
  tier_label TEXT NOT NULL, -- e.g., '1/2" - 1"', 'Small (up to 200 sq ft)'
  min_value NUMERIC, -- min diameter in inches or min sq ft
  max_value NUMERIC, -- max diameter in inches or max sq ft
  unit TEXT NOT NULL, -- 'inches' or 'sq_ft'
  one_time_cost NUMERIC NOT NULL DEFAULT 0,
  monthly_cost NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.control_pricing_tiers ENABLE ROW LEVEL SECURITY;

-- Anyone can view pricing tiers (public reference data)
CREATE POLICY "Anyone can view control pricing tiers"
ON public.control_pricing_tiers
FOR SELECT
USING (true);

-- Only admins can manage pricing tiers
CREATE POLICY "Admins can manage control pricing tiers"
ON public.control_pricing_tiers
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));