
ALTER TABLE public.drawing_instances
  ADD COLUMN IF NOT EXISTS instance_number integer;

-- Backfill: number existing rows per (analysis_request_id, awp_class_name)
-- in creation order so existing UIs keep current numbers.
WITH numbered AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY analysis_request_id, awp_class_name
           ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM public.drawing_instances
  WHERE instance_number IS NULL
)
UPDATE public.drawing_instances di
SET instance_number = numbered.rn
FROM numbered
WHERE di.id = numbered.id;

CREATE INDEX IF NOT EXISTS drawing_instances_ar_class_num_idx
  ON public.drawing_instances (analysis_request_id, awp_class_name, instance_number);
