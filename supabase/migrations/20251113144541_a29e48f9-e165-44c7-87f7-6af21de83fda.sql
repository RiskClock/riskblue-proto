-- Add status field to company_proposals table to track submission state
ALTER TABLE company_proposals 
ADD COLUMN IF NOT EXISTS status text DEFAULT 'draft';

-- Update existing records to have 'submitted' status if they have all required controls
-- We'll set this programmatically from the app