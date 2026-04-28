-- Add a dedicated vendor_name column to preserve the legacy "vendor" who currently sits in mitigation_controls.author
ALTER TABLE public.mitigation_controls
ADD COLUMN IF NOT EXISTS vendor_name text;

-- Copy current author values into vendor_name (preserve legacy vendor data)
UPDATE public.mitigation_controls
SET vendor_name = author
WHERE vendor_name IS NULL;

-- Set every control's author to 'RiskClock' (RiskClock authored all controls)
UPDATE public.mitigation_controls
SET author = 'RiskClock';

-- Default for any future control inserts
ALTER TABLE public.mitigation_controls
ALTER COLUMN author SET DEFAULT 'RiskClock';