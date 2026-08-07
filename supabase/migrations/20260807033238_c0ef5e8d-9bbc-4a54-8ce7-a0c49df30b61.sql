ALTER TABLE public.critical_assets
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'Asset';

INSERT INTO public.critical_assets
  (name, category, threat, risk_level, risk_level_points, cost, image_url, display_order, is_active, probability, impact, default_control_ids, can_span_multiple_spaces, id_prefix)
VALUES
  ('Kitchen Equipment', 'Equipment & Fixtures', 'Appliance leak, supply line failure', 'Medium', 3, 'Medium', '', 14, true, 3, 3, '{}', false, 'KWEQ'),
  ('Washroom Fixtures', 'Equipment & Fixtures', 'Fixture leak, overflow', 'Medium', 3, 'Medium', '', 15, true, 3, 3, '{}', false, 'WCFX'),
  ('Laundry Equipment', 'Equipment & Fixtures', 'Hose failure, water heater leak', 'Medium', 3, 'Medium', '', 16, true, 3, 3, '{}', false, 'LDEQ');