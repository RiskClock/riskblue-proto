-- Add additional_parameters column to project_analysis_items
ALTER TABLE project_analysis_items 
ADD COLUMN IF NOT EXISTS additional_parameters JSONB DEFAULT NULL;

-- Delete and re-insert correct pricing tiers for Automatic Shut Off Valve
DELETE FROM control_pricing_tiers WHERE control_name = 'Automatic Shut Off Valve';
INSERT INTO control_pricing_tiers (control_name, tier_type, tier_label, min_value, max_value, one_time_cost, monthly_cost, unit) VALUES
  ('Automatic Shut Off Valve', 'diameter', '0.5" - 1"', 0.5, 1, 500, 0, 'inches'),
  ('Automatic Shut Off Valve', 'diameter', '1.1" - 2"', 1.1, 2, 900, 0, 'inches'),
  ('Automatic Shut Off Valve', 'diameter', '2.1" - 4"', 2.1, 4, 2500, 0, 'inches'),
  ('Automatic Shut Off Valve', 'diameter', '4.1" - 6"', 4.1, 6, 4500, 0, 'inches'),
  ('Automatic Shut Off Valve', 'diameter', '6.1" - 8"', 6.1, 8, 12000, 0, 'inches'),
  ('Automatic Shut Off Valve', 'diameter', '8.1" - 10"', 8.1, 10, 18000, 0, 'inches');

-- Delete and re-insert correct pricing tiers for Ultrasonic Flow Sensors (monthly rental)
DELETE FROM control_pricing_tiers WHERE control_name = 'Ultrasonic Flow Sensors';
INSERT INTO control_pricing_tiers (control_name, tier_type, tier_label, min_value, max_value, one_time_cost, monthly_cost, unit) VALUES
  ('Ultrasonic Flow Sensors', 'diameter', '0.5" - 1"', 0.5, 1, 0, 240, 'inches'),
  ('Ultrasonic Flow Sensors', 'diameter', '1.1" - 2"', 1.1, 2, 0, 324, 'inches'),
  ('Ultrasonic Flow Sensors', 'diameter', '2.1" - 4"', 2.1, 4, 0, 480, 'inches'),
  ('Ultrasonic Flow Sensors', 'diameter', '4.1" - 6"', 4.1, 6, 0, 624, 'inches'),
  ('Ultrasonic Flow Sensors', 'diameter', '6.1" - 8"', 6.1, 8, 0, 715, 'inches'),
  ('Ultrasonic Flow Sensors', 'diameter', '8.1" - 10"', 8.1, 10, 0, 800, 'inches');

-- Delete and re-insert correct pricing tiers for In-line Flow Monitoring / Inline Flow Sensors
DELETE FROM control_pricing_tiers WHERE control_name IN ('In-line Flow Monitoring', 'Inline Flow Sensors');
INSERT INTO control_pricing_tiers (control_name, tier_type, tier_label, min_value, max_value, one_time_cost, monthly_cost, unit) VALUES
  ('In-line Flow Monitoring', 'diameter', '0.5" - 1"', 0.5, 1, 2000, 0, 'inches'),
  ('In-line Flow Monitoring', 'diameter', '1.1" - 2"', 1.1, 2, 2500, 0, 'inches'),
  ('In-line Flow Monitoring', 'diameter', '2.1" - 3"', 2.1, 3, 3500, 0, 'inches'),
  ('In-line Flow Monitoring', 'diameter', '3.1" - 4"', 3.1, 4, 5000, 0, 'inches'),
  ('In-line Flow Monitoring', 'diameter', '4.1" - 6"', 4.1, 6, 8000, 0, 'inches'),
  ('In-line Flow Monitoring', 'diameter', '6.1" - 8"', 6.1, 8, 12000, 0, 'inches');