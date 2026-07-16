
-- =====================================================================
-- Audit: bounding boxes (analysis_request_sheets.floor_plan_overrides)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.audit_floor_plan_overrides()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_email text;
  v_name text;
  v_project uuid;
  v_old jsonb := COALESCE(OLD.floor_plan_overrides, '{}'::jsonb);
  v_new jsonb := COALESCE(NEW.floor_plan_overrides, '{}'::jsonb);
  v_key text;
  v_page int := NEW.page_index;
  v_sheet_label text := COALESCE(NEW.sheet_number, NEW.sheet_title, 'Sheet');
BEGIN
  IF v_old = v_new THEN
    RETURN NEW;
  END IF;

  SELECT ar.project_id INTO v_project
  FROM public.analysis_requests ar
  JOIN public.analysis_request_files f ON f.analysis_request_id = ar.id
  WHERE f.id = NEW.parent_file_id
  LIMIT 1;

  IF v_actor IS NOT NULL THEN
    SELECT email, COALESCE(raw_user_meta_data->>'display_name', email)
    INTO v_email, v_name
    FROM auth.users WHERE id = v_actor;
  END IF;

  -- Added or updated overrides
  FOR v_key IN SELECT jsonb_object_keys(v_new) LOOP
    IF NOT (v_old ? v_key) THEN
      INSERT INTO public.project_audit_events(
        project_id, actor_user_id, actor_email, actor_name,
        entity_type, entity_id, action, summary, details
      ) VALUES (
        v_project, v_actor, v_email, v_name,
        'floor_plan_override', NEW.id::text || ':' || v_key, 'bbox_added',
        format('%s added a bounding box (%s) on %s page %s',
          COALESCE(v_name,'System/User'), v_key, v_sheet_label, v_page),
        jsonb_build_object('sheet_id', NEW.id, 'page_index', v_page, 'key', v_key, 'to', v_new->v_key)
      );
    ELSIF v_old->v_key IS DISTINCT FROM v_new->v_key THEN
      INSERT INTO public.project_audit_events(
        project_id, actor_user_id, actor_email, actor_name,
        entity_type, entity_id, action, summary, details
      ) VALUES (
        v_project, v_actor, v_email, v_name,
        'floor_plan_override', NEW.id::text || ':' || v_key, 'bbox_updated',
        format('%s updated bounding box (%s) on %s page %s',
          COALESCE(v_name,'System/User'), v_key, v_sheet_label, v_page),
        jsonb_build_object('sheet_id', NEW.id, 'page_index', v_page, 'key', v_key,
                          'from', v_old->v_key, 'to', v_new->v_key)
      );
    END IF;
  END LOOP;

  FOR v_key IN SELECT jsonb_object_keys(v_old) LOOP
    IF NOT (v_new ? v_key) THEN
      INSERT INTO public.project_audit_events(
        project_id, actor_user_id, actor_email, actor_name,
        entity_type, entity_id, action, summary, details
      ) VALUES (
        v_project, v_actor, v_email, v_name,
        'floor_plan_override', NEW.id::text || ':' || v_key, 'bbox_removed',
        format('%s removed bounding box (%s) from %s page %s',
          COALESCE(v_name,'System/User'), v_key, v_sheet_label, v_page),
        jsonb_build_object('sheet_id', NEW.id, 'page_index', v_page, 'key', v_key,
                          'from', v_old->v_key)
      );
    END IF;
  END LOOP;

  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS audit_floor_plan_overrides_trg ON public.analysis_request_sheets;
CREATE TRIGGER audit_floor_plan_overrides_trg
AFTER UPDATE OF floor_plan_overrides ON public.analysis_request_sheets
FOR EACH ROW EXECUTE FUNCTION public.audit_floor_plan_overrides();

-- =====================================================================
-- Audit: spatial hierarchy stored in analysis_requests.space_hierarchy_json
-- =====================================================================
CREATE OR REPLACE FUNCTION public.audit_analysis_spatial()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_email text;
  v_name text;
  v_project uuid;
  v_old_records jsonb;
  v_new_records jsonb;
  v_old_map jsonb := '{}'::jsonb;
  v_new_map jsonb := '{}'::jsonb;
  r jsonb;
  v_key text;
  v_label_from text;
  v_label_to text;
BEGIN
  IF NEW.space_hierarchy_json IS NOT DISTINCT FROM OLD.space_hierarchy_json THEN
    RETURN NEW;
  END IF;

  v_project := NEW.project_id;

  IF v_actor IS NOT NULL THEN
    SELECT email, COALESCE(raw_user_meta_data->>'display_name', email)
    INTO v_email, v_name
    FROM auth.users WHERE id = v_actor;
  END IF;

  v_old_records := COALESCE(OLD.space_hierarchy_json->'parsed'->'spatial_records', '[]'::jsonb);
  v_new_records := COALESCE(NEW.space_hierarchy_json->'parsed'->'spatial_records', '[]'::jsonb);

  IF v_old_records = v_new_records THEN
    RETURN NEW;
  END IF;

  FOR r IN SELECT value FROM jsonb_array_elements(v_old_records) AS value LOOP
    v_key := COALESCE(r->>'standardized_space_name', r->>'name', r->>'id');
    IF v_key IS NOT NULL THEN
      v_old_map := v_old_map || jsonb_build_object(v_key, r);
    END IF;
  END LOOP;
  FOR r IN SELECT value FROM jsonb_array_elements(v_new_records) AS value LOOP
    v_key := COALESCE(r->>'standardized_space_name', r->>'name', r->>'id');
    IF v_key IS NOT NULL THEN
      v_new_map := v_new_map || jsonb_build_object(v_key, r);
    END IF;
  END LOOP;

  FOR v_key IN SELECT jsonb_object_keys(v_new_map) LOOP
    IF NOT (v_old_map ? v_key) THEN
      INSERT INTO public.project_audit_events(
        project_id, actor_user_id, actor_email, actor_name,
        entity_type, entity_id, action, summary, details
      ) VALUES (
        v_project, v_actor, v_email, v_name,
        'spatial_level', v_key, 'level_added',
        format('%s added spatial level "%s"', COALESCE(v_name,'System/User'), v_key),
        jsonb_build_object('level', v_new_map->v_key)
      );
    ELSIF v_old_map->v_key IS DISTINCT FROM v_new_map->v_key THEN
      INSERT INTO public.project_audit_events(
        project_id, actor_user_id, actor_email, actor_name,
        entity_type, entity_id, action, summary, details
      ) VALUES (
        v_project, v_actor, v_email, v_name,
        'spatial_level', v_key, 'level_updated',
        format('%s updated spatial level "%s"', COALESCE(v_name,'System/User'), v_key),
        jsonb_build_object('from', v_old_map->v_key, 'to', v_new_map->v_key)
      );
    END IF;
  END LOOP;

  FOR v_key IN SELECT jsonb_object_keys(v_old_map) LOOP
    IF NOT (v_new_map ? v_key) THEN
      INSERT INTO public.project_audit_events(
        project_id, actor_user_id, actor_email, actor_name,
        entity_type, entity_id, action, summary, details
      ) VALUES (
        v_project, v_actor, v_email, v_name,
        'spatial_level', v_key, 'level_removed',
        format('%s removed spatial level "%s"', COALESCE(v_name,'System/User'), v_key),
        jsonb_build_object('level', v_old_map->v_key)
      );
    END IF;
  END LOOP;

  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS audit_analysis_spatial_trg ON public.analysis_requests;
CREATE TRIGGER audit_analysis_spatial_trg
AFTER UPDATE OF space_hierarchy_json ON public.analysis_requests
FOR EACH ROW EXECUTE FUNCTION public.audit_analysis_spatial();
