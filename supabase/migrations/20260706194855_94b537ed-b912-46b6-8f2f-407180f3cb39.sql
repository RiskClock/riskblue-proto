
-- Rename "Domestic Cold Water" water system to "Cold Water" (acronym CW)
UPDATE public.water_systems
SET name = 'Cold Water', id_prefix = 'CW'
WHERE name = 'Domestic Cold Water';

-- Propagate the name change to all tables that reference it by name.
UPDATE public.drawing_instances          SET awp_class_name = 'Cold Water' WHERE awp_class_name = 'Domestic Cold Water';
UPDATE public.analysis_results           SET awp_class_name = 'Cold Water' WHERE awp_class_name = 'Domestic Cold Water';
UPDATE public.annotation_consolidations  SET awp_class_name = 'Cold Water' WHERE awp_class_name = 'Domestic Cold Water';
UPDATE public.workbench_triage_overrides SET awp_class_name = 'Cold Water' WHERE awp_class_name = 'Domestic Cold Water';
UPDATE public.wmsv_control_selections    SET awp_class_name = 'Cold Water' WHERE awp_class_name = 'Domestic Cold Water';
UPDATE public.analysis_triage_overrides  SET awp_class_name = 'Cold Water' WHERE awp_class_name = 'Domestic Cold Water';
UPDATE public.awp_class_control_mappings SET awp_class_name = 'Cold Water' WHERE awp_class_name = 'Domestic Cold Water';
UPDATE public.analysis_triage_results    SET awp_class_name = 'Cold Water' WHERE awp_class_name = 'Domestic Cold Water';
UPDATE public.awp_class_prompts          SET awp_class_name = 'Cold Water' WHERE awp_class_name = 'Domestic Cold Water';
UPDATE public.analysis_pipeline_jobs     SET awp_class_name = 'Cold Water' WHERE awp_class_name = 'Domestic Cold Water';
