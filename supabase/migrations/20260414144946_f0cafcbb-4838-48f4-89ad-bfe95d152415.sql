
-- Update unique constraint on wmsv_control_selections to use category+control instead of awp_class_name+control
ALTER TABLE public.wmsv_control_selections 
  DROP CONSTRAINT IF EXISTS wmsv_control_selections_user_awp_control_key;

-- Clear existing data (no real selections yet)
DELETE FROM public.wmsv_control_selections;

-- Add new unique constraint by category + control
ALTER TABLE public.wmsv_control_selections 
  ADD CONSTRAINT wmsv_control_selections_user_category_control_key 
  UNIQUE (user_id, category, control_id);
