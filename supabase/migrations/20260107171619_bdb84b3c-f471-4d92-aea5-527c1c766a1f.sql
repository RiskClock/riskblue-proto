-- Add probability and impact columns to critical_assets
ALTER TABLE critical_assets 
ADD COLUMN probability INTEGER NOT NULL DEFAULT 3,
ADD COLUMN impact INTEGER NOT NULL DEFAULT 3;

-- Add probability and impact columns to water_systems
ALTER TABLE water_systems 
ADD COLUMN probability INTEGER NOT NULL DEFAULT 3,
ADD COLUMN impact INTEGER NOT NULL DEFAULT 3;

-- Add probability and impact columns to processes
ALTER TABLE processes 
ADD COLUMN probability INTEGER NOT NULL DEFAULT 3,
ADD COLUMN impact INTEGER NOT NULL DEFAULT 3;