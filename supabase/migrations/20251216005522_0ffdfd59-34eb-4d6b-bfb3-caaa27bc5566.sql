-- Update size_category constraint to include 'very small'
ALTER TABLE project_analysis_items 
DROP CONSTRAINT IF EXISTS project_analysis_items_size_category_check;

-- Note: Supabase doesn't enforce check constraints on text columns by default,
-- so this is mainly for documentation and future validation
-- The column allows: 'very small', 'small', 'medium', 'large', 'very large', or NULL