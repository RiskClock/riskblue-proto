-- Add risk_level_points column to critical_assets table
ALTER TABLE public.critical_assets 
ADD COLUMN risk_level_points integer NOT NULL DEFAULT 0;

-- Add risk_level_points column to water_systems table
ALTER TABLE public.water_systems 
ADD COLUMN risk_level_points integer NOT NULL DEFAULT 0;

-- Update critical_assets with numeric risk points based on risk_level
-- Extreme Risk = 25, Very High Risk = 20, High Risk = 15, Moderate Risk = 10, Low Risk = 5
UPDATE public.critical_assets SET risk_level_points = CASE
  WHEN risk_level ILIKE '%extreme%' THEN 25
  WHEN risk_level ILIKE '%very high%' THEN 20
  WHEN risk_level ILIKE '%high%' THEN 15
  WHEN risk_level ILIKE '%moderate%' THEN 10
  WHEN risk_level ILIKE '%low%' THEN 5
  ELSE 0
END;

-- Update water_systems with numeric risk points based on risk_level
UPDATE public.water_systems SET risk_level_points = CASE
  WHEN risk_level ILIKE '%extreme%' THEN 25
  WHEN risk_level ILIKE '%very high%' THEN 20
  WHEN risk_level ILIKE '%high%' THEN 15
  WHEN risk_level ILIKE '%moderate%' THEN 10
  WHEN risk_level ILIKE '%low%' THEN 5
  ELSE 0
END;