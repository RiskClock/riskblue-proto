-- Create critical_assets table
CREATE TABLE public.critical_assets (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  threat text NOT NULL,
  risk_level text NOT NULL,
  duration text NOT NULL,
  cost text NOT NULL,
  image_url text NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Create water_systems table
CREATE TABLE public.water_systems (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  threat text NOT NULL,
  risk_level text NOT NULL,
  duration text NOT NULL,
  cost text NOT NULL,
  image_url text NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Create mitigation_controls table
CREATE TABLE public.mitigation_controls (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  category text NOT NULL,
  description text NOT NULL,
  points integer NOT NULL DEFAULT 0,
  popularity integer NOT NULL DEFAULT 0,
  action text NOT NULL,
  author text NOT NULL,
  responsible text NOT NULL,
  image_url text NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Create control_assets junction table (many-to-many)
CREATE TABLE public.control_assets (
  control_id uuid NOT NULL REFERENCES public.mitigation_controls(id) ON DELETE CASCADE,
  asset_name text NOT NULL,
  PRIMARY KEY (control_id, asset_name)
);

-- Create control_systems junction table (many-to-many)
CREATE TABLE public.control_systems (
  control_id uuid NOT NULL REFERENCES public.mitigation_controls(id) ON DELETE CASCADE,
  system_name text NOT NULL,
  PRIMARY KEY (control_id, system_name)
);

-- Create indexes for better query performance
CREATE INDEX idx_critical_assets_active ON public.critical_assets(is_active, display_order);
CREATE INDEX idx_water_systems_active ON public.water_systems(is_active, display_order);
CREATE INDEX idx_mitigation_controls_active ON public.mitigation_controls(is_active, display_order);
CREATE INDEX idx_mitigation_controls_category ON public.mitigation_controls(category);
CREATE INDEX idx_control_assets_control_id ON public.control_assets(control_id);
CREATE INDEX idx_control_systems_control_id ON public.control_systems(control_id);

-- Enable Row Level Security
ALTER TABLE public.critical_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.water_systems ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mitigation_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.control_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.control_systems ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Public read access (anyone can view the catalog)
CREATE POLICY "Anyone can view active critical assets"
  ON public.critical_assets
  FOR SELECT
  USING (true);

CREATE POLICY "Anyone can view active water systems"
  ON public.water_systems
  FOR SELECT
  USING (true);

CREATE POLICY "Anyone can view active mitigation controls"
  ON public.mitigation_controls
  FOR SELECT
  USING (true);

CREATE POLICY "Anyone can view control-asset relationships"
  ON public.control_assets
  FOR SELECT
  USING (true);

CREATE POLICY "Anyone can view control-system relationships"
  ON public.control_systems
  FOR SELECT
  USING (true);

-- RLS Policies: Authenticated users can insert/update/delete (for now, will add admin role later)
CREATE POLICY "Authenticated users can manage critical assets"
  ON public.critical_assets
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can manage water systems"
  ON public.water_systems
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can manage mitigation controls"
  ON public.mitigation_controls
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can manage control-asset relationships"
  ON public.control_assets
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can manage control-system relationships"
  ON public.control_systems
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Add triggers for automatic timestamp updates
CREATE TRIGGER update_critical_assets_updated_at
  BEFORE UPDATE ON public.critical_assets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_water_systems_updated_at
  BEFORE UPDATE ON public.water_systems
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_mitigation_controls_updated_at
  BEFORE UPDATE ON public.mitigation_controls
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();