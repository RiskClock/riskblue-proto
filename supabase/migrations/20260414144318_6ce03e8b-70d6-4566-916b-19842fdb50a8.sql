
-- Drop old unique constraint and add control_id
ALTER TABLE public.wmsv_control_selections 
  ADD COLUMN control_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';

-- Remove old unique constraint
ALTER TABLE public.wmsv_control_selections 
  DROP CONSTRAINT IF EXISTS wmsv_control_selections_user_id_awp_class_name_key;

-- Clear any existing data (table is new, no real data yet)
DELETE FROM public.wmsv_control_selections;

-- Remove default from control_id
ALTER TABLE public.wmsv_control_selections 
  ALTER COLUMN control_id DROP DEFAULT;

-- Add new unique constraint
ALTER TABLE public.wmsv_control_selections 
  ADD CONSTRAINT wmsv_control_selections_user_awp_control_key 
  UNIQUE (user_id, awp_class_name, control_id);
