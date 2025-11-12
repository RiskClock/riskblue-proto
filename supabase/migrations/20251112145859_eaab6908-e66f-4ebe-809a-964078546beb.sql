-- Remove the automatic edited_at trigger that updates on every change
-- This allows application logic to control when edited_at is updated
DROP TRIGGER IF EXISTS update_company_proposals_edited_at ON public.company_proposals;

-- The updated_at trigger can remain as it's for database-level tracking
-- edited_at will now only be updated when the Save button is clicked in the app