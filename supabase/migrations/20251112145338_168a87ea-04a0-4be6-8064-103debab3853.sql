-- Add unique constraint to company_proposals to enable proper UPSERT
ALTER TABLE public.company_proposals 
ADD CONSTRAINT company_proposals_project_company_system_unique 
UNIQUE (project_id, company, system_name);