-- Add description_summary and systems_at_risk columns to mitigation_controls table
ALTER TABLE mitigation_controls 
ADD COLUMN IF NOT EXISTS description_summary text,
ADD COLUMN IF NOT EXISTS systems_at_risk text;