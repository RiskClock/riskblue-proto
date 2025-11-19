-- Phase 1: Add new columns to company_proposals for proper foreign key relationships
ALTER TABLE public.company_proposals 
ADD COLUMN IF NOT EXISTS control_id uuid,
ADD COLUMN IF NOT EXISTS collaborator_id uuid;

-- Backfill control_id by matching system_name to mitigation_controls.name
UPDATE public.company_proposals cp
SET control_id = mc.id
FROM public.mitigation_controls mc
WHERE cp.system_name = mc.name
  AND cp.control_id IS NULL;

-- Backfill collaborator_id by matching project_id + company to project_collaborators
UPDATE public.company_proposals cp
SET collaborator_id = pc.id
FROM public.project_collaborators pc
WHERE cp.project_id = pc.project_id 
  AND cp.company = pc.company
  AND cp.collaborator_id IS NULL;

-- Add foreign key constraints
ALTER TABLE public.company_proposals
DROP CONSTRAINT IF EXISTS fk_company_proposals_control;

ALTER TABLE public.company_proposals
ADD CONSTRAINT fk_company_proposals_control
FOREIGN KEY (control_id) REFERENCES public.mitigation_controls(id) ON DELETE CASCADE;

ALTER TABLE public.company_proposals
DROP CONSTRAINT IF EXISTS fk_company_proposals_collaborator;

ALTER TABLE public.company_proposals
ADD CONSTRAINT fk_company_proposals_collaborator
FOREIGN KEY (collaborator_id) REFERENCES public.project_collaborators(id) ON DELETE CASCADE;

-- Drop old unique constraint
ALTER TABLE public.company_proposals 
DROP CONSTRAINT IF EXISTS company_proposals_project_id_company_system_name_key;

-- Add new unique constraint using IDs
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'company_proposals_project_id_collaborator_id_control_id_key'
  ) THEN
    ALTER TABLE public.company_proposals
    ADD CONSTRAINT company_proposals_project_id_collaborator_id_control_id_key
    UNIQUE (project_id, collaborator_id, control_id);
  END IF;
END $$;

-- Make new columns NOT NULL after backfilling
ALTER TABLE public.company_proposals
ALTER COLUMN control_id SET NOT NULL;

ALTER TABLE public.company_proposals
ALTER COLUMN collaborator_id SET NOT NULL;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_company_proposals_control_id ON public.company_proposals(control_id);
CREATE INDEX IF NOT EXISTS idx_company_proposals_collaborator_id ON public.company_proposals(collaborator_id);