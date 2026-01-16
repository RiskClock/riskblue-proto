
-- Create riskred_controls table first (referenced by riskred_asp)
CREATE TABLE public.riskred_controls (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code text NOT NULL,
  name text NOT NULL,
  category text NOT NULL,
  description text,
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.riskred_controls ENABLE ROW LEVEL SECURITY;

-- Anyone can view controls
CREATE POLICY "Anyone can view riskred controls" ON public.riskred_controls
  FOR SELECT USING (true);

-- Create riskred_asp table (combined Assets, Systems, Processes)
CREATE TABLE public.riskred_asp (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('Asset', 'System', 'Process')),
  subcategory text NOT NULL,
  probability integer NOT NULL DEFAULT 3,
  impact integer NOT NULL DEFAULT 3,
  id_prefix text,
  default_control_ids uuid[] NOT NULL DEFAULT '{}',
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.riskred_asp ENABLE ROW LEVEL SECURITY;

-- Anyone can view ASP classes
CREATE POLICY "Anyone can view riskred asp" ON public.riskred_asp
  FOR SELECT USING (true);

-- Internal users can update ASP classes
CREATE POLICY "Internal users can update riskred asp" ON public.riskred_asp
  FOR UPDATE USING (is_internal_user(auth.uid()))
  WITH CHECK (is_internal_user(auth.uid()));

-- Create riskred_analysis_items table (project instances)
CREATE TABLE public.riskred_analysis_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  item_id text NOT NULL,
  name text NOT NULL,
  instance_name text,
  category text NOT NULL,
  subcategory text,
  floor text,
  area_name text,
  controls text[] DEFAULT '{}',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.riskred_analysis_items ENABLE ROW LEVEL SECURITY;

-- Users can view items for their projects or internal
CREATE POLICY "Users can view riskred items for their projects or internal" ON public.riskred_analysis_items
  FOR SELECT USING (
    (EXISTS (SELECT 1 FROM projects WHERE projects.id = riskred_analysis_items.project_id AND projects.user_id = auth.uid()))
    OR is_internal_user(auth.uid())
  );

-- Users can insert items for their projects or internal
CREATE POLICY "Users can insert riskred items for their projects or internal" ON public.riskred_analysis_items
  FOR INSERT WITH CHECK (
    (EXISTS (SELECT 1 FROM projects WHERE projects.id = riskred_analysis_items.project_id AND projects.user_id = auth.uid()))
    OR is_internal_user(auth.uid())
  );

-- Users can update items for their projects or internal
CREATE POLICY "Users can update riskred items for their projects or internal" ON public.riskred_analysis_items
  FOR UPDATE USING (
    (EXISTS (SELECT 1 FROM projects WHERE projects.id = riskred_analysis_items.project_id AND projects.user_id = auth.uid()))
    OR is_internal_user(auth.uid())
  );

-- Users can delete items for their projects or internal
CREATE POLICY "Users can delete riskred items for their projects or internal" ON public.riskred_analysis_items
  FOR DELETE USING (
    (EXISTS (SELECT 1 FROM projects WHERE projects.id = riskred_analysis_items.project_id AND projects.user_id = auth.uid()))
    OR is_internal_user(auth.uid())
  );

-- Add trigger for updated_at
CREATE TRIGGER update_riskred_analysis_items_updated_at
  BEFORE UPDATE ON public.riskred_analysis_items
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Insert RiskRed Controls (30 controls)
INSERT INTO public.riskred_controls (code, name, category, description, display_order) VALUES
('IC-01', 'Hot Work Permit System', 'Ignition Prevention', 'Formal permit system for all hot work activities', 1),
('IC-02', 'Electrical Safety Protocol', 'Ignition Prevention', 'Comprehensive electrical safety and inspection protocol', 2),
('IC-03', 'Smoking Prohibition Enforcement', 'Ignition Prevention', 'Strict smoking prohibition with designated areas only', 3),
('IC-04', 'Temporary Heating Controls', 'Ignition Prevention', 'Safe use and monitoring of temporary heating equipment', 4),
('IC-05', 'Cutting/Grinding Safety', 'Ignition Prevention', 'Spark containment measures for cutting and grinding', 5),
('FM-01', 'Combustible Material Storage', 'Fuel Load Management', 'Proper storage and separation of combustible materials', 6),
('FM-02', 'Waste Management Protocol', 'Fuel Load Management', 'Regular removal of combustible waste and debris', 7),
('FM-03', 'Flammable Liquid Controls', 'Fuel Load Management', 'Safe storage and handling of flammable liquids', 8),
('FM-04', 'Temporary Structure Materials', 'Fuel Load Management', 'Fire-resistant materials for temporary structures', 9),
('FM-05', 'Insulation Material Management', 'Fuel Load Management', 'Safe handling of combustible insulation', 10),
('CP-01', 'Fire Barrier Maintenance', 'Compartmentation', 'Maintaining fire barrier integrity during construction', 11),
('CP-02', 'Penetration Sealing', 'Compartmentation', 'Temporary and permanent sealing of fire barrier penetrations', 12),
('CP-03', 'Fire Door Management', 'Compartmentation', 'Proper installation and maintenance of fire doors', 13),
('CP-04', 'Vertical Opening Protection', 'Compartmentation', 'Protection of stairwells, shafts, and vertical openings', 14),
('CP-05', 'Construction Opening Controls', 'Compartmentation', 'Temporary protection of construction openings', 15),
('DT-01', 'Fire Detection Installation', 'Detection', 'Early installation of permanent fire detection', 16),
('DT-02', 'Temporary Detection Systems', 'Detection', 'Temporary fire detection during construction', 17),
('DT-03', 'Fire Watch Program', 'Detection', 'Trained fire watch personnel for high-risk activities', 18),
('DT-04', 'Alarm Communication', 'Detection', 'Clear alarm notification and communication systems', 19),
('DT-05', 'Detection System Testing', 'Detection', 'Regular testing of all detection systems', 20),
('SP-01', 'Standpipe Installation', 'Suppression', 'Early installation and activation of standpipes', 21),
('SP-02', 'Sprinkler System Activation', 'Suppression', 'Progressive activation of sprinkler systems', 22),
('SP-03', 'Fire Extinguisher Deployment', 'Suppression', 'Strategic placement and maintenance of extinguishers', 23),
('SP-04', 'Fire Hose Stations', 'Suppression', 'Installation and accessibility of fire hose stations', 24),
('SP-05', 'Water Supply Verification', 'Suppression', 'Ensuring adequate fire water supply', 25),
('ER-01', 'Emergency Response Plan', 'Emergency Response', 'Comprehensive site emergency response plan', 26),
('ER-02', 'Evacuation Routes', 'Emergency Response', 'Clear and maintained evacuation routes', 27),
('ER-03', 'Fire Brigade Access', 'Emergency Response', 'Maintained access for fire brigade vehicles', 28),
('ER-04', 'Emergency Training', 'Emergency Response', 'Regular fire safety training for all workers', 29),
('ER-05', 'Communication Systems', 'Emergency Response', 'Emergency communication and alarm systems', 30);

-- Insert RiskRed ASP Classes (29 classes from the data)
-- Assets - Temporary Structures
INSERT INTO public.riskred_asp (name, type, subcategory, probability, impact, id_prefix, display_order) VALUES
('Temporary Site Offices & Welfare Units', 'Asset', 'Temporary Structures', 4, 3, 'TS', 1),
('Material Storage Areas', 'Asset', 'Temporary Structures', 4, 4, 'MS', 2),
('Scaffolding & Temporary Access', 'Asset', 'Temporary Structures', 3, 3, 'SA', 3),
('Temporary Enclosures & Weather Protection', 'Asset', 'Temporary Structures', 3, 3, 'TE', 4);

-- Assets - Building Areas
INSERT INTO public.riskred_asp (name, type, subcategory, probability, impact, id_prefix, display_order) VALUES
('Basement & Underground Levels', 'Asset', 'Building Areas', 3, 5, 'BU', 5),
('Vertical Shafts & Risers', 'Asset', 'Building Areas', 3, 5, 'VS', 6),
('Mechanical & Electrical Rooms', 'Asset', 'Building Areas', 4, 5, 'ME', 7),
('Roof Areas', 'Asset', 'Building Areas', 3, 4, 'RA', 8),
('Parking Structures', 'Asset', 'Building Areas', 3, 4, 'PS', 9),
('Common Areas & Corridors', 'Asset', 'Building Areas', 2, 3, 'CA', 10);

-- Assets - Construction Equipment
INSERT INTO public.riskred_asp (name, type, subcategory, probability, impact, id_prefix, display_order) VALUES
('Tower Cranes', 'Asset', 'Construction Equipment', 2, 4, 'TC', 11),
('Material Hoists', 'Asset', 'Construction Equipment', 2, 3, 'MH', 12),
('Generators & Temporary Power', 'Asset', 'Construction Equipment', 4, 4, 'GP', 13),
('Fuel Storage Areas', 'Asset', 'Construction Equipment', 4, 5, 'FS', 14);

-- Systems - Fire Safety Systems
INSERT INTO public.riskred_asp (name, type, subcategory, probability, impact, id_prefix, display_order) VALUES
('Temporary Fire Detection', 'System', 'Fire Safety Systems', 3, 4, 'TFD', 15),
('Standpipe Systems', 'System', 'Fire Safety Systems', 2, 4, 'SPS', 16),
('Sprinkler Systems (Partial)', 'System', 'Fire Safety Systems', 2, 4, 'SPR', 17),
('Fire Extinguisher Stations', 'System', 'Fire Safety Systems', 2, 3, 'FES', 18),
('Emergency Lighting', 'System', 'Fire Safety Systems', 2, 3, 'EL', 19);

-- Systems - Utility Systems
INSERT INTO public.riskred_asp (name, type, subcategory, probability, impact, id_prefix, display_order) VALUES
('Temporary Electrical Distribution', 'System', 'Utility Systems', 4, 4, 'TED', 20),
('Temporary Heating Systems', 'System', 'Utility Systems', 4, 4, 'THS', 21),
('Gas Distribution (if applicable)', 'System', 'Utility Systems', 3, 5, 'GD', 22);

-- Processes - Hot Work Activities
INSERT INTO public.riskred_asp (name, type, subcategory, probability, impact, id_prefix, display_order) VALUES
('Welding Operations', 'Process', 'Hot Work Activities', 5, 4, 'WO', 23),
('Cutting & Grinding', 'Process', 'Hot Work Activities', 5, 4, 'CG', 24),
('Torch Applied Roofing', 'Process', 'Hot Work Activities', 5, 5, 'TAR', 25),
('Soldering & Brazing', 'Process', 'Hot Work Activities', 4, 3, 'SB', 26);

-- Processes - High-Risk Activities
INSERT INTO public.riskred_asp (name, type, subcategory, probability, impact, id_prefix, display_order) VALUES
('Spray Painting & Coating', 'Process', 'High-Risk Activities', 4, 4, 'SPC', 27),
('Foam Insulation Installation', 'Process', 'High-Risk Activities', 4, 5, 'FI', 28),
('Adhesive Application', 'Process', 'High-Risk Activities', 3, 3, 'AA', 29);
