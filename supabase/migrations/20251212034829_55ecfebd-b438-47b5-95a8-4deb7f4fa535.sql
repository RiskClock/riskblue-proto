ALTER TABLE public.mitigation_controls 
ADD COLUMN IF NOT EXISTS risk_tolerance integer DEFAULT 3;