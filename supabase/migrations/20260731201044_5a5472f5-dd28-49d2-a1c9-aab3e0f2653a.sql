CREATE OR REPLACE FUNCTION public.clone_project(p_source_project_id uuid, p_target_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_project_id uuid := gen_random_uuid();
  v_source_ar_id uuid;
  v_target_ar_id uuid;
  v_source_file_id uuid;
  v_target_file_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = p_source_project_id) THEN
    RAISE EXCEPTION 'Source project not found';
  END IF;

  -- Copy project row
  INSERT INTO public.projects (
    id, user_id, name, project_type, location, address_1, address_2, city, state, zip_code, country,
    has_builders_risk_policy, construction_start_date, construction_end_date, building_type, tower_type,
    total_floors, typical_floors, typical_floors_start, typical_floors_end,
    underground_parking, underground_parking_start, underground_parking_end,
    above_grade_parking, project_data, created_at, updated_at, status, filesearch_store_id,
    drive_folder_id, estimated_units, selected_awp_class_names, selected_other_classes,
    credits_consumed, report_file_path, report_file_name, workbench_status, selected_awp_subtypes
  )
  SELECT
    v_target_project_id, user_id, p_target_name, project_type, location, address_1, address_2, city, state, zip_code, country,
    has_builders_risk_policy, construction_start_date, construction_end_date, building_type, tower_type,
    total_floors, typical_floors, typical_floors_start, typical_floors_end,
    underground_parking, underground_parking_start, underground_parking_end,
    above_grade_parking, project_data, now(), now(), status, filesearch_store_id,
    drive_folder_id, estimated_units, selected_awp_class_names, selected_other_classes,
    credits_consumed, report_file_path, report_file_name, workbench_status, selected_awp_subtypes
  FROM public.projects WHERE id = p_source_project_id;

  -- Copy project roles
  INSERT INTO public.project_user_roles (
    project_id, user_id, role, created_at, email_notifications_enabled
  )
  SELECT
    v_target_project_id, user_id, role, now(), email_notifications_enabled
  FROM public.project_user_roles WHERE project_id = p_source_project_id;

  -- Copy analysis request (limit 1 to match current project model)
  SELECT id INTO v_source_ar_id
  FROM public.analysis_requests
  WHERE project_id = p_source_project_id
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_source_ar_id IS NOT NULL THEN
    INSERT INTO public.analysis_requests (
      id, project_id, user_id, drive_folder_id, status, file_count, total_size_bytes, storage_path,
      error_message, created_at, updated_at, source_type, summary_data, triage_tokens_used, triage_model,
      analyze_model, disabled_awp_classes, analyze_tokens_used, pipeline_phase, pipeline_progress_done,
      pipeline_progress_total, pipeline_stop_requested, analysis_run_id, started_at, sheet_normalization_enabled,
      pipeline_phase_override, space_hierarchy_json, space_hierarchy_status, space_hierarchy_error, space_hierarchy_updated_at
    )
    SELECT
      gen_random_uuid(), v_target_project_id, user_id, drive_folder_id, status, file_count, total_size_bytes, storage_path,
      error_message, now(), now(), source_type, summary_data, triage_tokens_used, triage_model,
      analyze_model, disabled_awp_classes, analyze_tokens_used, pipeline_phase, pipeline_progress_done,
      pipeline_progress_total, pipeline_stop_requested, analysis_run_id, started_at, sheet_normalization_enabled,
      pipeline_phase_override, space_hierarchy_json, space_hierarchy_status, space_hierarchy_error, space_hierarchy_updated_at
    FROM public.analysis_requests WHERE id = v_source_ar_id
    RETURNING id INTO v_target_ar_id;

    -- Copy analysis request file
    SELECT id INTO v_source_file_id
    FROM public.analysis_request_files
    WHERE analysis_request_id = v_source_ar_id
    ORDER BY created_at ASC
    LIMIT 1;

    IF v_source_file_id IS NOT NULL THEN
      INSERT INTO public.analysis_request_files (
        id, analysis_request_id, drive_file_id, name, mime_type, size_bytes, relative_path, storage_path,
        copy_status, created_at, openai_file_id, openai_file_uploaded_at, openai_file_expires_at,
        openai_file_status, extracted_text, expected_page_count, split_status, survey_raw_response,
        survey_raw_updated_at, gemini_cache_id, gemini_cache_expires_at, risk_element_results,
        survey_tokens, survey_model, page_rotations
      )
      SELECT
        gen_random_uuid(), v_target_ar_id, drive_file_id, name, mime_type, size_bytes, relative_path, storage_path,
        copy_status, now(), openai_file_id, openai_file_uploaded_at, openai_file_expires_at,
        openai_file_status, extracted_text, expected_page_count, split_status, survey_raw_response,
        survey_raw_updated_at, gemini_cache_id, gemini_cache_expires_at, risk_element_results,
        survey_tokens, survey_model, page_rotations
      FROM public.analysis_request_files WHERE id = v_source_file_id
      RETURNING id INTO v_target_file_id;

      -- Build sheet id mapping
      CREATE TEMP TABLE sheet_map ON COMMIT DROP AS
      SELECT id AS old_id, gen_random_uuid() AS new_id
      FROM public.analysis_request_sheets
      WHERE analysis_request_id = v_source_ar_id;

      -- Copy sheets
      INSERT INTO public.analysis_request_sheets (
        id, analysis_request_id, parent_file_id, page_index, name, storage_path, extracted_text,
        extract_status, extract_error, openai_file_id, openai_file_status, openai_file_uploaded_at,
        openai_file_expires_at, sheet_number, sheet_title, discipline, drawing_type, floor_or_level,
        metadata_confidence, metadata_source, created_at, updated_at, png_storage_path, survey_result,
        survey_updated_at, floor_plan_overrides
      )
      SELECT
        sm.new_id, v_target_ar_id, v_target_file_id, s.page_index, s.name, s.storage_path, s.extracted_text,
        s.extract_status, s.extract_error, s.openai_file_id, s.openai_file_status, s.openai_file_uploaded_at,
        s.openai_file_expires_at, s.sheet_number, s.sheet_title, s.discipline, s.drawing_type, s.floor_or_level,
        s.metadata_confidence, s.metadata_source, now(), now(), s.png_storage_path, s.survey_result,
        s.survey_updated_at, s.floor_plan_overrides
      FROM public.analysis_request_sheets s
      JOIN sheet_map sm ON s.id = sm.old_id;

      -- Copy annotations using sheet mapping
      INSERT INTO public.drawing_instances (
        id, analysis_request_id, file_id, sheet_id, awp_class_name, nx, ny, page_index, created_by,
        created_at, instance_number, metadata
      )
      SELECT
        gen_random_uuid(), v_target_ar_id, v_target_file_id, sm.new_id, di.awp_class_name, di.nx, di.ny,
        di.page_index, di.created_by, now(), di.instance_number, di.metadata
      FROM public.drawing_instances di
      JOIN sheet_map sm ON di.sheet_id = sm.old_id
      WHERE di.analysis_request_id = v_source_ar_id;
    END IF;
  END IF;

  RETURN v_target_project_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.clone_project(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clone_project(uuid, text) TO service_role;