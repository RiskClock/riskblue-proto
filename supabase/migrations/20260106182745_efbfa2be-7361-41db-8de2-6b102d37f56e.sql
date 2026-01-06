-- Add default_control_ids and id_prefix columns to critical_assets
ALTER TABLE public.critical_assets 
ADD COLUMN IF NOT EXISTS default_control_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
ADD COLUMN IF NOT EXISTS id_prefix text;

-- Add default_control_ids and id_prefix columns to water_systems  
ALTER TABLE public.water_systems 
ADD COLUMN IF NOT EXISTS default_control_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
ADD COLUMN IF NOT EXISTS id_prefix text;

-- Add default_control_ids and id_prefix columns to processes
ALTER TABLE public.processes 
ADD COLUMN IF NOT EXISTS default_control_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
ADD COLUMN IF NOT EXISTS id_prefix text;

-- Populate id_prefix for critical_assets (mapping from awp_classes names to critical_assets names)
UPDATE public.critical_assets SET id_prefix = 'ERM' WHERE name = 'Electrical Room';
UPDATE public.critical_assets SET id_prefix = 'ELVP' WHERE name = 'Elevator Pit';
UPDATE public.critical_assets SET id_prefix = 'STE' WHERE name = 'Suite';
UPDATE public.critical_assets SET id_prefix = 'MRM' WHERE name = 'Mechanical Room';
UPDATE public.critical_assets SET id_prefix = 'ERS' WHERE name = 'Electrical Riser';
UPDATE public.critical_assets SET id_prefix = 'MRS' WHERE name = 'Mechanical Riser';
UPDATE public.critical_assets SET id_prefix = 'MTM' WHERE name = 'Mass Timber and Millwork';
UPDATE public.critical_assets SET id_prefix = 'FEER' WHERE name = 'Facade, Envelope, Exterior, and Roofing';
UPDATE public.critical_assets SET id_prefix = 'KW' WHERE name = 'Kitchens & Washroom';

-- Populate id_prefix for water_systems
UPDATE public.water_systems SET id_prefix = 'TWR' WHERE name = 'Temporary Water Run';
UPDATE public.water_systems SET id_prefix = 'HYD' WHERE name = 'Hydronics';
UPDATE public.water_systems SET id_prefix = 'FS' WHERE name = 'Fire Suppression System';
UPDATE public.water_systems SET id_prefix = 'SPSDD' WHERE name = 'Sump Pits, Storm Drains and Drainages';
UPDATE public.water_systems SET id_prefix = 'DHW' WHERE name = 'Domestic Hot Water';
UPDATE public.water_systems SET id_prefix = 'DCW' WHERE name = 'Domestic Cold Water';

-- Populate id_prefix for processes
UPDATE public.processes SET id_prefix = 'CONT' WHERE name = 'Contractor Team';
UPDATE public.processes SET id_prefix = 'WMVP' WHERE name = 'Water Mitigation Vendor Process';
UPDATE public.processes SET id_prefix = 'MCP' WHERE name = 'Mechanical Contractor Process';
UPDATE public.processes SET id_prefix = 'ENGP' WHERE name = 'Engineering Process';

-- Migrate control mappings to critical_assets
-- Electrical Room/Rooms -> Water Piping + Presence of Water Monitoring
UPDATE public.critical_assets 
SET default_control_ids = ARRAY['202f324b-6413-4116-acd0-aea3f2ebd571'::uuid, 'a5acff5a-d8a0-402b-9085-cb3aea2f6999'::uuid]
WHERE name = 'Electrical Room';

-- Electrical Riser -> Presence of Water Monitoring
UPDATE public.critical_assets 
SET default_control_ids = ARRAY['a5acff5a-d8a0-402b-9085-cb3aea2f6999'::uuid]
WHERE name = 'Electrical Riser';

-- Elevator Pit -> Presence of Water Monitoring
UPDATE public.critical_assets 
SET default_control_ids = ARRAY['a5acff5a-d8a0-402b-9085-cb3aea2f6999'::uuid]
WHERE name = 'Elevator Pit';

-- Kitchens & Washroom -> Presence of Water Monitoring
UPDATE public.critical_assets 
SET default_control_ids = ARRAY['a5acff5a-d8a0-402b-9085-cb3aea2f6999'::uuid]
WHERE name = 'Kitchens & Washroom';

-- Mass Timber and Millwork -> Lumber Moisture Content + Presence of Water Monitoring + Weather Station
UPDATE public.critical_assets 
SET default_control_ids = ARRAY['308438dc-5585-41d6-8bb0-33fe9f7b2eb3'::uuid, 'a5acff5a-d8a0-402b-9085-cb3aea2f6999'::uuid, '060cff9b-ab7b-4d85-865d-f8b93b67fb06'::uuid]
WHERE name = 'Mass Timber and Millwork';

-- Mechanical Riser -> Presence of Water Monitoring
UPDATE public.critical_assets 
SET default_control_ids = ARRAY['a5acff5a-d8a0-402b-9085-cb3aea2f6999'::uuid]
WHERE name = 'Mechanical Riser';

-- Mechanical Room -> Presence of Water Monitoring
UPDATE public.critical_assets 
SET default_control_ids = ARRAY['a5acff5a-d8a0-402b-9085-cb3aea2f6999'::uuid]
WHERE name = 'Mechanical Room';

-- Suite -> Suite Drains
UPDATE public.critical_assets 
SET default_control_ids = ARRAY['431c4db4-f984-4ce9-93a1-c948ed2c8c1e'::uuid]
WHERE name = 'Suite';

-- Migrate control mappings to water_systems
-- Sump Pits, Storm Drains and Drainages -> Below Grade Water Response Plan + Temporary/Permanent Sump Pumps + Presence of Water Monitoring
UPDATE public.water_systems 
SET default_control_ids = ARRAY['02035877-fc09-47a0-a45c-270bc7a9711f'::uuid, '97ad37bd-d54e-42bd-85df-efc9c62547e9'::uuid, 'a5acff5a-d8a0-402b-9085-cb3aea2f6999'::uuid]
WHERE name = 'Sump Pits, Storm Drains and Drainages';

-- Temporary Water Run -> Presence of Water Monitoring
UPDATE public.water_systems 
SET default_control_ids = ARRAY['a5acff5a-d8a0-402b-9085-cb3aea2f6999'::uuid]
WHERE name = 'Temporary Water Run';