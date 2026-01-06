-- Create AWP Classes lookup table
CREATE TABLE public.awp_classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL CHECK (category IN ('Asset', 'Water System', 'Process')),
  id_prefix TEXT NOT NULL UNIQUE,
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.awp_classes ENABLE ROW LEVEL SECURITY;

-- Anyone can view AWP classes
CREATE POLICY "Anyone can view AWP classes" ON public.awp_classes
  FOR SELECT USING (true);

-- Admins can manage AWP classes
CREATE POLICY "Admins can manage AWP classes" ON public.awp_classes
  FOR ALL USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Seed the 18 AWP classes
INSERT INTO public.awp_classes (name, category, id_prefix, display_order) VALUES
  -- Assets (7)
  ('Electrical Rooms', 'Asset', 'ERM', 1),
  ('Mechanical Rooms', 'Asset', 'MRM', 2),
  ('Mechanical Risers', 'Asset', 'MRS', 3),
  ('Main Electrical Risers', 'Asset', 'ERS', 4),
  ('Elevator Pits', 'Asset', 'ELVP', 5),
  ('Suites', 'Asset', 'STE', 6),
  ('Sump Pits', 'Asset', 'SMP', 7),
  -- Water Systems (6)
  ('Cold Domestic Water - Main City Entry', 'Water System', 'DCW-MCE', 10),
  ('Cold Domestic Water - Main Entry', 'Water System', 'DCW-ME', 11),
  ('Cold Domestic Water - Zone Entry', 'Water System', 'DCW-ZE', 12),
  ('Domestic Hot Water - Hot Water Return', 'Water System', 'DHW-HWR', 13),
  ('Domestic Hot Water - Zone Entry', 'Water System', 'DHW-HWZE', 14),
  ('Fire Suppression', 'Water System', 'FS', 15),
  ('Temporary Water Run', 'Water System', 'TWR', 16),
  -- Processes (3)
  ('Kitchens and Washrooms', 'Process', 'KW', 20),
  ('Sump Pit / Storm Drain / Drainage', 'Process', 'SPSDD', 21),
  ('Facade / Envelope / Exterior / Roofing', 'Process', 'FEER', 22);

-- Add awp_class_id column to awp_class_control_mappings
ALTER TABLE public.awp_class_control_mappings
  ADD COLUMN awp_class_id UUID REFERENCES public.awp_classes(id);

-- Populate awp_class_id based on awp_class_name
UPDATE public.awp_class_control_mappings m
SET awp_class_id = c.id
FROM public.awp_classes c
WHERE m.awp_class_name = c.name;

-- Add awp_class_id column to project_analysis_items
ALTER TABLE public.project_analysis_items
  ADD COLUMN awp_class_id UUID REFERENCES public.awp_classes(id);

-- Populate awp_class_id based on name
UPDATE public.project_analysis_items p
SET awp_class_id = c.id
FROM public.awp_classes c
WHERE p.name = c.name;

-- Add the missing control mapping for Electrical Rooms
-- "Water Piping in and Around Electrical Rooms" control
INSERT INTO public.awp_class_control_mappings (awp_class_name, control_id, awp_class_id)
SELECT 'Electrical Rooms', '202f324b-6413-4116-acd0-aea3f2ebd571', id
FROM public.awp_classes WHERE name = 'Electrical Rooms'
ON CONFLICT DO NOTHING;