-- Add area_sqft column to project_analysis_items
ALTER TABLE project_analysis_items ADD COLUMN IF NOT EXISTS area_sqft numeric;