-- Add estimated_cost column to mitigation_controls table
ALTER TABLE public.mitigation_controls 
ADD COLUMN estimated_cost numeric DEFAULT 0;

-- Populate with random values between $100 and $5000 (in $100 increments)
UPDATE public.mitigation_controls 
SET estimated_cost = (floor(random() * 50) + 1) * 100;