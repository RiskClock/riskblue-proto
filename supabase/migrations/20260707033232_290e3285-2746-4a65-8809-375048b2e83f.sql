-- 1) Rename "Domestic Hot Water" (DHW) → "Hot Water" (HW)
UPDATE public.water_systems
SET name = 'Hot Water', id_prefix = 'HW'
WHERE name = 'Domestic Hot Water';

-- Propagate the name change to all tables that reference it by name.
UPDATE public.drawing_instances          SET awp_class_name = 'Hot Water' WHERE awp_class_name = 'Domestic Hot Water';
UPDATE public.analysis_results           SET awp_class_name = 'Hot Water' WHERE awp_class_name = 'Domestic Hot Water';
UPDATE public.annotation_consolidations  SET awp_class_name = 'Hot Water' WHERE awp_class_name = 'Domestic Hot Water';
UPDATE public.workbench_triage_overrides SET awp_class_name = 'Hot Water' WHERE awp_class_name = 'Domestic Hot Water';
UPDATE public.wmsv_control_selections    SET awp_class_name = 'Hot Water' WHERE awp_class_name = 'Domestic Hot Water';
UPDATE public.analysis_triage_overrides  SET awp_class_name = 'Hot Water' WHERE awp_class_name = 'Domestic Hot Water';
UPDATE public.awp_class_control_mappings SET awp_class_name = 'Hot Water' WHERE awp_class_name = 'Domestic Hot Water';
UPDATE public.analysis_triage_results    SET awp_class_name = 'Hot Water' WHERE awp_class_name = 'Domestic Hot Water';
UPDATE public.awp_class_prompts          SET awp_class_name = 'Hot Water' WHERE awp_class_name = 'Domestic Hot Water';
UPDATE public.analysis_pipeline_jobs     SET awp_class_name = 'Hot Water' WHERE awp_class_name = 'Domestic Hot Water';

-- 2) Clean stale entries in workbench_column_preferences:
--    Replace legacy "Domestic Cold Water" / "Domestic Hot Water" with the
--    canonical names, deduping so we never end up with two of the same class.
UPDATE public.workbench_column_preferences p
SET awp_class_names = sub.cleaned
FROM (
  SELECT
    id,
    ARRAY(
      SELECT DISTINCT ON (
        CASE elem
          WHEN 'Domestic Cold Water' THEN 'Cold Water'
          WHEN 'Domestic Hot Water'  THEN 'Hot Water'
          ELSE elem
        END
      )
      CASE elem
        WHEN 'Domestic Cold Water' THEN 'Cold Water'
        WHEN 'Domestic Hot Water'  THEN 'Hot Water'
        ELSE elem
      END
      FROM unnest(awp_class_names) WITH ORDINALITY AS t(elem, ord)
      ORDER BY
        CASE elem
          WHEN 'Domestic Cold Water' THEN 'Cold Water'
          WHEN 'Domestic Hot Water'  THEN 'Hot Water'
          ELSE elem
        END,
        ord
    ) AS cleaned
  FROM public.workbench_column_preferences
) sub
WHERE p.id = sub.id
  AND p.awp_class_names IS DISTINCT FROM sub.cleaned;

-- 3) Also clean any per-project class aliases that reference the old names.
UPDATE public.project_class_aliases
SET awp_class_name = 'Cold Water'
WHERE awp_class_name = 'Domestic Cold Water';

UPDATE public.project_class_aliases
SET awp_class_name = 'Hot Water'
WHERE awp_class_name = 'Domestic Hot Water';

-- 4) Add per-project acronym override alongside the display alias.
ALTER TABLE public.project_class_aliases
  ADD COLUMN IF NOT EXISTS alias_prefix TEXT;