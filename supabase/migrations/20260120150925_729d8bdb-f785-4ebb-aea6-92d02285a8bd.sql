-- Phase 1: Add new columns to riskred_asp table
ALTER TABLE riskred_asp 
ADD COLUMN IF NOT EXISTS risk_tolerance integer DEFAULT 3,
ADD COLUMN IF NOT EXISTS risk_level_points integer DEFAULT 9,
ADD COLUMN IF NOT EXISTS start_date_formula text,
ADD COLUMN IF NOT EXISTS end_date_formula text;

-- Make subcategory nullable since we're not using it for RiskRed ASPs
ALTER TABLE riskred_asp ALTER COLUMN subcategory DROP NOT NULL;

-- Phase 2: Add new columns to riskred_controls table  
ALTER TABLE riskred_controls
ADD COLUMN IF NOT EXISTS author text,
ADD COLUMN IF NOT EXISTS responsible text,
ADD COLUMN IF NOT EXISTS derisk_points integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS actions text,
ADD COLUMN IF NOT EXISTS risk_tolerance integer DEFAULT 3,
ADD COLUMN IF NOT EXISTS one_time_cost numeric,
ADD COLUMN IF NOT EXISTS concept_hours numeric,
ADD COLUMN IF NOT EXISTS hourly_rate numeric,
ADD COLUMN IF NOT EXISTS monthly_maint_hours numeric,
ADD COLUMN IF NOT EXISTS monthly_maint_cost numeric;

-- Drop category column from riskred_controls (controls grouped by ASP mapping instead)
ALTER TABLE riskred_controls DROP COLUMN IF EXISTS category;

-- Phase 3: Clear existing data
DELETE FROM riskred_analysis_items;
DELETE FROM riskred_asp;
DELETE FROM riskred_controls;

-- Phase 4: Insert new RiskRed ASP Classes (13 total)
INSERT INTO riskred_asp (id_prefix, type, name, subcategory, risk_tolerance, probability, impact, risk_level_points, start_date_formula, end_date_formula, display_order, is_active)
VALUES
  ('TS', 'Asset', 'Temporary Structures', 'Temporary Structures', 3, 3, 4, 12, 'Construction Start Date', 'Construction End Date', 1, true),
  ('MAT', 'Asset', 'Materials', 'Materials', 2, 4, 4, 16, 'Construction Start Date', 'Construction End Date', 2, true),
  ('PS', 'Asset', 'Permanent Structure', 'Permanent Structure', 1, 4, 5, 20, 'Construction Start Date', 'Construction End Date', 3, true),
  ('FW', 'Asset', 'Finished Works', 'Finished Works', 3, 4, 5, 20, 'Construction Start Date', 'Construction End Date', 4, true),
  ('TI', 'Asset', 'Temporary Installations', 'Temporary Installations', 3, 3, 4, 12, 'Envelope Start Date', 'Interior Finishes End Date', 5, true),
  ('PE', 'Asset', 'Plant & Equipment', 'Plant & Equipment', 3, 2, 5, 10, 'Structure Start Date', 'Fire Suppression End Date', 6, true),
  ('SC', 'Asset', 'Site Conditions', 'Site Conditions', 3, 3, 5, 15, 'MEP Start Date', 'Building Envelope end date', 7, true),
  ('CE', 'Asset', 'Critical Enablers', 'Critical Enablers', 3, 3, 5, 15, 'MEP Start Date', 'Construction End Date', 8, true),
  ('CA', 'Process', 'Construction Activities', 'Construction Activities', 1, 4, 5, 20, 'Interior Finishes Start Date - 30 days', 'Construction End Date', 9, true),
  ('SO', 'Process', 'Site Operations', 'Site Operations', 3, 4, 4, 16, 'Construction Start Date', 'Building Envelope end date', 10, true),
  ('TSYS', 'System', 'Temporary Systems', 'Temporary Systems', 1, 3, 4, 12, 'Construction Start Date', 'Construction End Date', 11, true),
  ('FSS', 'System', 'Fire Safety Systems', 'Fire Safety Systems', 3, 4, 3, 12, 'Construction Start Date', 'Construction End Date', 12, true),
  ('SS', 'System', 'Site Systems', 'Site Systems', 2, 2, 4, 8, 'Construction Start Date', 'Construction End Date', 13, true);

-- Phase 5: Insert new RiskRed Controls (36 total)
INSERT INTO riskred_controls (code, name, author, responsible, derisk_points, description, actions, risk_tolerance, one_time_cost, concept_hours, hourly_rate, monthly_maint_hours, monthly_maint_cost, display_order, is_active)
VALUES
  ('RR001', 'Hot Works Permit System', 'RiskClock', 'Engineering', 10, 'Formal permit and supervision for welding cutting and grinding', 'A formal hot works permit system is enforced with authorization, supervision, and close-out requirements.', 2, 1500, 10, 150, NULL, 0, 1, true),
  ('RR002', 'Combustible Removal Before Hot Works', 'RiskClock', 'Fire Mitigation Vendor', 5, 'Clear combustible materials prior to hot works', 'Combustible materials are removed or protected prior to commencement of hot works.', 2, 1700, 10, 170, NULL, 0, 2, true),
  ('RR003', 'Approved Electrical Installations', 'RiskClock', 'Mechanical Contractor', 9, 'Temporary electrics installed and certified by competent persons', 'All electrical installations are installed and certified by competent persons.', 2, 1700, 10, 170, NULL, 0, 3, true),
  ('RR004', 'Equipment Inspection & Maintenance', 'RiskClock', 'Contractor', 12, 'Regular inspection and servicing of plant and tools', 'Plant and equipment are inspected and maintained in accordance with manufacturer requirements.', 1, 2000, 10, 200, NULL, 0, 4, true),
  ('RR005', 'Controlled Smoking Areas', 'RiskClock', 'Mechanical Contractor', 5, 'Designated smoking zones away from combustibles', 'Smoking is restricted to designated areas located away from combustible materials.', 1, 1500, 10, 150, NULL, 0, 5, true),
  ('RR006', 'Battery Charging Protocols', 'RiskClock', 'Contractor', 5, 'Managed charging locations and procedures for lithium-ion batteries', 'Battery charging is controlled in designated areas with defined safety procedures.', 3, 1800, 12, 150, NULL, 0, 6, true),
  ('RR007', 'Segregated Flammable Storage', 'RiskClock', 'Mechanical Contractor', 2, 'Separate storage of combustible and flammable materials', 'Flammable materials are stored in segregated, designated locations.', 3, 1500, 10, 150, NULL, 0, 7, true),
  ('RR008', 'Fire-Resistant Storage Containers', 'RiskClock', 'Mechanical Contractor', 1, 'Use of fire-rated containers for fuels and chemicals', 'Approved fire-rated containers are used for flammable liquids and chemicals.', 3, 1500, 10, 150, NULL, 0, 8, true),
  ('RR009', 'Waste Management & Daily Removal', 'RiskClock', 'Mechanical Contractor', 15, 'Regular removal of combustible waste', 'Combustible waste is removed from site daily and controlled at all times.', 3, 2400, 12, 200, NULL, 0, 9, true),
  ('RR010', 'Quantity Limits on Combustibles', 'RiskClock', 'Mechanical Contractor', 23, 'Limit amount of combustible materials on site', 'Combustible material quantities on site are limited to operational minimums.', 3, 2400, 12, 200, NULL, 0, 10, true),
  ('RR011', 'Separation Distances for Storage', 'RiskClock', 'Engineering', 4, 'Maintain safe distances between storage and structures', 'Minimum separation distances between storage and structures are maintained.', 3, 1600, 8, 200, 4, 800, 11, true),
  ('RR012', 'Temporary Smoke / Heat Detection', 'RiskClock', 'Fire Mitigation Vendor', 2, 'Temporary fire detection systems installed on site', 'Temporary fire detection systems are installed in high-risk construction areas.', 3, 1500, 10, 150, NULL, 0, 12, true),
  ('RR013', 'Fire Watch During Hot Works', 'RiskClock', 'Fire Mitigation Vendor', 5, 'Dedicated personnel monitoring during hot works', 'Trained fire watch personnel are assigned during hot works activities.', 3, 1500, 10, 150, NULL, 0, 13, true),
  ('RR014', 'Post-Hot Work Fire Watch', 'RiskClock', 'Mechanical Contractor', 1, 'Extended monitoring after hot works complete', 'Fire watch monitoring continues following completion of hot works.', 3, 1500, 10, 150, NULL, 0, 14, true),
  ('RR015', 'Night Fire Patrols', 'RiskClock', 'Contractor', 3, 'Regular patrols during unoccupied hours', 'Fire patrols are conducted during unoccupied or out-of-hours periods.', 3, 1200, 8, 150, 4, 600, 15, true),
  ('RR016', 'Remote Monitoring / Thermal Cameras', 'RiskClock', 'Mechanical Contractor', 7, 'Use of cameras or sensors for early fire detection', 'Remote monitoring or thermal detection is used to identify abnormal heat conditions.', 2, 1500, 10, 150, NULL, 0, 16, true),
  ('RR017', 'Fire Extinguishers', 'RiskClock', 'Contractor', 15, 'Appropriate extinguishers provided and maintained', 'Appropriate fire extinguishers are provided, maintained, and readily accessible.', 3, 1700, 10, 170, NULL, 0, 17, true),
  ('RR018', 'Firefighting Training', 'RiskClock', 'Contractor', 15, 'Training workers in first-aid firefighting', 'Personnel receive basic fire response and extinguisher training.', 3, 1700, 10, 170, NULL, 0, 18, true),
  ('RR019', 'Temporary Fire Hoses / Standpipes', 'RiskClock', 'Engineering', 20, 'Provision of water-based suppression systems', 'Temporary firefighting water supplies are provided where required.', 3, 1700, 10, 170, NULL, 0, 19, true),
  ('RR020', 'Fire Blankets', 'RiskClock', 'Engineering', 2, 'Fire blankets provided near hot work areas', 'Fire blankets are provided in hot work and high-risk areas.', 3, 1200, 8, 150, 4, 600, 20, true),
  ('RR021', 'Dedicated Fire Water Supply', 'RiskClock', 'Fire Mitigation Vendor', 3, 'Reserved water supply for firefighting use', 'A dedicated water supply for firefighting purposes is maintained.', 3, 1200, 8, 150, 4, 600, 21, true),
  ('RR022', 'Temporary Fire Barriers', 'RiskClock', 'Contractor', 4, 'Temporary walls or barriers to restrict fire spread', 'Temporary fire barriers are installed to restrict fire spread.', 1, 1500, 10, 150, 2, 300, 22, true),
  ('RR023', 'Fire-Resistant Enclosures', 'RiskClock', 'Mechanical Contractor', 8, 'Fire-rated enclosures for critical assets', 'Fire-rated enclosures protect critical equipment and assets.', 2, 0, NULL, 150, 4, 600, 23, true),
  ('RR024', 'Sealing of Shafts & Penetrations', 'RiskClock', 'Mechanical Contractor', 10, 'Temporary sealing of risers and openings', 'Service penetrations and shafts are sealed to limit fire spread.', 3, 1500, 10, 150, NULL, 0, 24, true),
  ('RR025', 'Early Installation of Fire Protection', 'RiskClock', 'Engineering', 2, 'Install permanent fire protection earlier than usual', 'Permanent fire protection systems are installed early where practicable.', 3, 1200, 8, 150, 4, 600, 25, true),
  ('RR026', 'Zoning & Compartmentalisation', 'RiskClock', 'Mechanical Contractor', 15, 'Divide site into fire zones', 'The site is divided into defined fire zones to limit fire spread.', 3, 1500, 10, 150, NULL, 0, 26, true),
  ('RR027', 'Construction Phase Fire Risk Assessment', 'RiskClock', 'Fire Mitigation Vendor', 4, 'Formal fire risk assessment for construction stage', 'A construction phase fire risk assessment is completed and reviewed.', 2, 0, 0, 150, 4, 600, 27, true),
  ('RR028', 'Phased Fire Strategy', 'RiskClock', 'Contractor', 10, 'Fire strategy aligned with build sequence', 'A phased fire strategy aligned with construction sequencing is implemented.', 3, 1200, 8, 150, 4, 600, 28, true),
  ('RR029', 'Emergency Response Plan', 'RiskClock', 'Fire Mitigation Vendor', 2, 'Documented fire emergency procedures', 'A documented emergency response plan is in place and communicated.', 3, 0, 0, 150, 4, 600, 29, true),
  ('RR030', 'Fire Safety Induction', 'RiskClock', 'Mechanical Contractor', 20, 'Fire safety training during site induction', 'Fire safety procedures are included in site inductions.', 3, 600, 4, 150, NULL, 0, 30, true),
  ('RR031', 'Regular Fire Safety Audits', 'RiskClock', 'Contractor', 20, 'Routine inspections and audits', 'Regular fire safety inspections and audits are undertaken.', 3, 600, 4, 150, NULL, 0, 31, true),
  ('RR032', 'Off-Site Data Backups', 'RiskClock', 'Fire Mitigation Vendor', 3, 'Backups of drawings and data stored off-site', 'Critical project data is backed up off-site for recovery purposes.', 2, 1500, 10, 150, NULL, 0, 32, true),
  ('RR033', 'Insurance Compliance Controls', 'RiskClock', 'Mechanical Contractor', 10, 'Controls required by insurers implemented', 'Insurer-required fire protection measures are implemented and maintained.', 3, 600, 4, 150, NULL, 0, 33, true),
  ('RR034', 'Spare Equipment Strategy', 'RiskClock', 'Engineering', 5, 'Availability of replacement plant or equipment', 'Arrangements are in place for replacement of critical equipment.', 3, 300, 2, 150, 4, 600, 34, true),
  ('RR035', 'Incident Response Rehearsals', 'RiskClock', 'Contractor', 5, 'Practice fire response and recovery actions', 'Emergency response drills are conducted periodically.', 2, 0, NULL, 150, 2, 300, 35, true),
  ('RR036', 'Reinstatement Planning', 'RiskClock', 'Engineering', 3, 'Plans for rapid rebuild and recovery after fire', 'Post-fire recovery and reinstatement planning is established.', 3, 450, 3, 150, NULL, 0, 36, true);

-- Phase 6: Update ASP-to-Control mappings using control codes
-- TS: RR012, RR017, RR022
UPDATE riskred_asp SET default_control_ids = (
  SELECT ARRAY_AGG(id) FROM riskred_controls WHERE code IN ('RR012', 'RR017', 'RR022')
) WHERE id_prefix = 'TS';

-- MAT: RR007, RR010, RR011, RR002
UPDATE riskred_asp SET default_control_ids = (
  SELECT ARRAY_AGG(id) FROM riskred_controls WHERE code IN ('RR007', 'RR010', 'RR011', 'RR002')
) WHERE id_prefix = 'MAT';

-- PS: RR025, RR026, RR021
UPDATE riskred_asp SET default_control_ids = (
  SELECT ARRAY_AGG(id) FROM riskred_controls WHERE code IN ('RR025', 'RR026', 'RR021')
) WHERE id_prefix = 'PS';

-- FW: RR017, RR033, RR036
UPDATE riskred_asp SET default_control_ids = (
  SELECT ARRAY_AGG(id) FROM riskred_controls WHERE code IN ('RR017', 'RR033', 'RR036')
) WHERE id_prefix = 'FW';

-- TI: RR003, RR012
UPDATE riskred_asp SET default_control_ids = (
  SELECT ARRAY_AGG(id) FROM riskred_controls WHERE code IN ('RR003', 'RR012')
) WHERE id_prefix = 'TI';

-- PE: RR004, RR016, RR034
UPDATE riskred_asp SET default_control_ids = (
  SELECT ARRAY_AGG(id) FROM riskred_controls WHERE code IN ('RR004', 'RR016', 'RR034')
) WHERE id_prefix = 'PE';

-- SC: RR005, RR009
UPDATE riskred_asp SET default_control_ids = (
  SELECT ARRAY_AGG(id) FROM riskred_controls WHERE code IN ('RR005', 'RR009')
) WHERE id_prefix = 'SC';

-- CE: RR021, RR032, RR029
UPDATE riskred_asp SET default_control_ids = (
  SELECT ARRAY_AGG(id) FROM riskred_controls WHERE code IN ('RR021', 'RR032', 'RR029')
) WHERE id_prefix = 'CE';

-- CA: RR001, RR013, RR014, RR018
UPDATE riskred_asp SET default_control_ids = (
  SELECT ARRAY_AGG(id) FROM riskred_controls WHERE code IN ('RR001', 'RR013', 'RR014', 'RR018')
) WHERE id_prefix = 'CA';

-- SO: RR031, RR015, RR035
UPDATE riskred_asp SET default_control_ids = (
  SELECT ARRAY_AGG(id) FROM riskred_controls WHERE code IN ('RR031', 'RR015', 'RR035')
) WHERE id_prefix = 'SO';

-- TSYS: RR012, RR019, RR016
UPDATE riskred_asp SET default_control_ids = (
  SELECT ARRAY_AGG(id) FROM riskred_controls WHERE code IN ('RR012', 'RR019', 'RR016')
) WHERE id_prefix = 'TSYS';

-- FSS: RR017, RR021, RR029
UPDATE riskred_asp SET default_control_ids = (
  SELECT ARRAY_AGG(id) FROM riskred_controls WHERE code IN ('RR017', 'RR021', 'RR029')
) WHERE id_prefix = 'FSS';

-- SS: RR028, RR027, RR033
UPDATE riskred_asp SET default_control_ids = (
  SELECT ARRAY_AGG(id) FROM riskred_controls WHERE code IN ('RR028', 'RR027', 'RR033')
) WHERE id_prefix = 'SS';