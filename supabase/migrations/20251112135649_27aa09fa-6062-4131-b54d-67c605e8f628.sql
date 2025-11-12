-- Add editor tracking columns to company_proposals table
ALTER TABLE company_proposals 
ADD COLUMN editor_name text,
ADD COLUMN edited_at timestamp with time zone DEFAULT now();

-- Create trigger to automatically update edited_at
CREATE TRIGGER update_company_proposals_edited_at
  BEFORE UPDATE ON company_proposals
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();