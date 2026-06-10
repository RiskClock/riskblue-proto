
ALTER TABLE public.critical_assets
  ADD COLUMN IF NOT EXISTS can_span_multiple_spaces boolean NOT NULL DEFAULT false;
ALTER TABLE public.water_systems
  ADD COLUMN IF NOT EXISTS can_span_multiple_spaces boolean NOT NULL DEFAULT false;
ALTER TABLE public.processes
  ADD COLUMN IF NOT EXISTS can_span_multiple_spaces boolean NOT NULL DEFAULT false;

UPDATE public.critical_assets
SET can_span_multiple_spaces = true
WHERE id_prefix IN ('ERS', 'MRS')
   OR name IN ('Main Electrical Risers', 'Mechanical Risers');
