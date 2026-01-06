-- Phase 2: Create AWP Class Control Mappings table
CREATE TABLE public.awp_class_control_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  awp_class_name TEXT NOT NULL,
  control_id UUID NOT NULL REFERENCES public.mitigation_controls(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(awp_class_name, control_id)
);

-- Enable RLS
ALTER TABLE public.awp_class_control_mappings ENABLE ROW LEVEL SECURITY;

-- RLS policy: Anyone can view mappings (needed for control lookup)
CREATE POLICY "Anyone can view mappings"
ON public.awp_class_control_mappings FOR SELECT
USING (true);

-- RLS policy: Admins can manage mappings
CREATE POLICY "Admins can manage mappings"
ON public.awp_class_control_mappings FOR ALL
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Insert initial mappings based on existing application_component data
-- Map controls to their respective AWP class names (plural form used in UI)

-- Electrical Room Presence of Water Monitoring -> Electrical Rooms
INSERT INTO public.awp_class_control_mappings (awp_class_name, control_id)
SELECT 'Electrical Rooms', id FROM public.mitigation_controls 
WHERE name = 'Electrical Room Presence of Water Monitoring';

-- Mechanical Room Presence of Water Monitoring -> Mechanical Rooms
INSERT INTO public.awp_class_control_mappings (awp_class_name, control_id)
SELECT 'Mechanical Rooms', id FROM public.mitigation_controls 
WHERE name = 'Mechanical Room Presence of Water Monitoring';

-- Main Electrical Riser Presence of Water Monitoring -> Electrical Risers
INSERT INTO public.awp_class_control_mappings (awp_class_name, control_id)
SELECT 'Electrical Risers', id FROM public.mitigation_controls 
WHERE name = 'Main Electrical Riser Presence of Water Monitoring';

-- Mechanical Risers Presence of Water Monitoring -> Mechanical Risers
INSERT INTO public.awp_class_control_mappings (awp_class_name, control_id)
SELECT 'Mechanical Risers', id FROM public.mitigation_controls 
WHERE name = 'Mechanical Risers Presence of Water Monitoring';

-- Map controls with multiple application components
-- Cold Domestic Water Abnormal Flow Monitoring
INSERT INTO public.awp_class_control_mappings (awp_class_name, control_id)
SELECT unnest(ARRAY['Domestic Cold Water']), id FROM public.mitigation_controls 
WHERE name = 'Cold Domestic Water Abnormal Flow Monitoring';

-- Hot Domestic Water Abnormal Flow Monitoring
INSERT INTO public.awp_class_control_mappings (awp_class_name, control_id)
SELECT 'Domestic Hot Water', id FROM public.mitigation_controls 
WHERE name = 'Hot Domestic Water Abnormal Flow Monitoring';

-- Fire Suppression System Abnormal Flow Monitoring
INSERT INTO public.awp_class_control_mappings (awp_class_name, control_id)
SELECT 'Fire Suppression', id FROM public.mitigation_controls 
WHERE name = 'Fire Suppression System Abnormal Flow Monitoring';

-- Temporary Water Run Abnormal Flow Monitoring
INSERT INTO public.awp_class_control_mappings (awp_class_name, control_id)
SELECT 'Temporary Water Run', id FROM public.mitigation_controls 
WHERE name = 'Temporary Water Run Abnormal Flow Monitoring';

-- Suite Drains -> Suites
INSERT INTO public.awp_class_control_mappings (awp_class_name, control_id)
SELECT 'Suites', id FROM public.mitigation_controls 
WHERE name = 'Suite Drains';

-- Elevator Pit mapping (if exists)
INSERT INTO public.awp_class_control_mappings (awp_class_name, control_id)
SELECT 'Elevator Pits', id FROM public.mitigation_controls 
WHERE application_component ILIKE '%Elevator Pit%';

-- Sump Pit mapping
INSERT INTO public.awp_class_control_mappings (awp_class_name, control_id)
SELECT 'Sump Pit, Storm Drain, and Drainage', id FROM public.mitigation_controls 
WHERE application_component ILIKE '%Sump Pit%';

-- Kitchens & Washrooms mapping
INSERT INTO public.awp_class_control_mappings (awp_class_name, control_id)
SELECT 'Kitchens & Washrooms', id FROM public.mitigation_controls 
WHERE application_component ILIKE '%Kitchen%' OR application_component ILIKE '%Washroom%';

-- Mass Timber and Millwork mapping
INSERT INTO public.awp_class_control_mappings (awp_class_name, control_id)
SELECT 'Mass Timber and Millwork', id FROM public.mitigation_controls 
WHERE application_component ILIKE '%Mass Timber%' OR application_component ILIKE '%Millwork%';

-- Main Water Entry mapping
INSERT INTO public.awp_class_control_mappings (awp_class_name, control_id)
SELECT 'Main Water Entry', id FROM public.mitigation_controls 
WHERE application_component ILIKE '%Main Water Entry%';

-- Hydronics mapping
INSERT INTO public.awp_class_control_mappings (awp_class_name, control_id)
SELECT 'Hydronics', id FROM public.mitigation_controls 
WHERE application_component ILIKE '%Hydronic%';

-- Phase 3: Add drawing_url column to project_analysis_items
ALTER TABLE public.project_analysis_items ADD COLUMN IF NOT EXISTS drawing_url TEXT;

-- Phase 3: Create storage bucket for AWP drawings
INSERT INTO storage.buckets (id, name, public) 
VALUES ('awp-drawings', 'awp-drawings', true)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: Authenticated users can upload
CREATE POLICY "Authenticated users can upload drawings"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'awp-drawings');

-- Storage RLS: Authenticated users can update their uploads
CREATE POLICY "Authenticated users can update drawings"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'awp-drawings');

-- Storage RLS: Authenticated users can delete their uploads
CREATE POLICY "Authenticated users can delete drawings"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'awp-drawings');

-- Storage RLS: Public can view drawings
CREATE POLICY "Public can view drawings"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'awp-drawings');