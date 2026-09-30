CREATE OR REPLACE FUNCTION public.audit_drawing_instances()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_email text;
  v_name text;
  v_project uuid;
  v_summary text;
  v_action text;
  v_details jsonb := '{}'::jsonb;
  v_recent uuid;
  v_id text;
  v_label text;
  v_ref text;
  v_class text;
  v_num text;
  v_is_marker boolean;
BEGIN
  SELECT p.id INTO v_project
  FROM public.analysis_requests ar
  JOIN public.projects p ON p.id = ar.project_id
  WHERE ar.id = COALESCE(NEW.analysis_request_id, OLD.analysis_request_id);

  IF v_actor IS NOT NULL THEN
    SELECT email, COALESCE(raw_user_meta_data->>'display_name', email)
    INTO v_email, v_name
    FROM auth.users WHERE id = v_actor;
  END IF;

  v_class := COALESCE(NEW.awp_class_name, OLD.awp_class_name);
  v_num := COALESCE(COALESCE(NEW.instance_number, OLD.instance_number)::text, '?');
  v_is_marker := v_class = '__unit_marker__';
  -- Friendly reference used in every summary line
  v_ref := CASE WHEN v_is_marker
                THEN 'Unit/Detail marker #' || v_num
                ELSE format('[%s-%s]', v_class, v_num) END;

  IF TG_OP = 'INSERT' THEN
    v_action := 'created';
    v_id := NEW.id::text;
    v_label := CASE WHEN v_is_marker THEN v_ref
                    ELSE NEW.awp_class_name ||
                         CASE WHEN NEW.instance_number IS NOT NULL
                              THEN ' [' || NEW.awp_class_name || '-' || NEW.instance_number || ']'
                              ELSE '' END || ' marker' END;
    v_summary := format('%s added a new %s on page %s',
      COALESCE(v_name, 'System/User'), v_label, NEW.page_index);
    v_details := jsonb_build_object(
      'awp_class_name', NEW.awp_class_name,
      'instance_number', NEW.instance_number,
      'page_index', NEW.page_index,
      'nx', NEW.nx, 'ny', NEW.ny,
      'metadata', NEW.metadata
    );

  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'deleted';
    v_id := OLD.id::text;
    v_summary := format('%s deleted %s from page %s',
      COALESCE(v_name, 'System/User'),
      CASE WHEN v_is_marker THEN v_ref ELSE OLD.awp_class_name || ' marker ' || v_ref END,
      OLD.page_index);
    v_details := jsonb_build_object(
      'awp_class_name', OLD.awp_class_name,
      'instance_number', OLD.instance_number,
      'page_index', OLD.page_index,
      'nx', OLD.nx, 'ny', OLD.ny,
      'metadata', OLD.metadata
    );

  ELSE
    v_id := NEW.id::text;

    IF NEW.awp_class_name IS DISTINCT FROM OLD.awp_class_name THEN
      v_action := 'field_changed';
      v_summary := format('%s updated %s: Changed Asset Class from %s to %s',
        COALESCE(v_name, 'System/User'), v_ref,
        OLD.awp_class_name, NEW.awp_class_name);
      v_details := jsonb_build_object('field', 'awp_class_name',
        'from', OLD.awp_class_name, 'to', NEW.awp_class_name);

    ELSIF NEW.metadata IS DISTINCT FROM OLD.metadata THEN
      v_action := 'field_changed';
      IF COALESCE(NEW.metadata->>'marker_type','') IS DISTINCT FROM COALESCE(OLD.metadata->>'marker_type','') THEN
        v_summary := format('%s updated %s: Changed marker type from %s to %s',
          COALESCE(v_name,'System/User'), v_ref,
          initcap(COALESCE(NULLIF(OLD.metadata->>'marker_type',''),'Unit')),
          initcap(COALESCE(NULLIF(NEW.metadata->>'marker_type',''),'Unit')));
      ELSIF COALESCE(NEW.metadata->>'pipe_diameter','') IS DISTINCT FROM COALESCE(OLD.metadata->>'pipe_diameter','') THEN
        v_summary := format('%s updated %s: Changed Pipe Diameter from %s to %s',
          COALESCE(v_name,'System/User'), v_ref,
          COALESCE(OLD.metadata->>'pipe_diameter','—'),
          COALESCE(NEW.metadata->>'pipe_diameter','—'));
      ELSIF COALESCE(NEW.metadata->>'pipe_type','') IS DISTINCT FROM COALESCE(OLD.metadata->>'pipe_type','') THEN
        v_summary := format('%s updated %s: Changed Pipe Type from %s to %s',
          COALESCE(v_name,'System/User'), v_ref,
          COALESCE(OLD.metadata->>'pipe_type','—'),
          COALESCE(NEW.metadata->>'pipe_type','—'));
      ELSE
        v_summary := format('%s updated %s: details changed',
          COALESCE(v_name,'System/User'), v_ref);
      END IF;
      v_details := jsonb_build_object('from', OLD.metadata, 'to', NEW.metadata);

    ELSIF NEW.nx IS DISTINCT FROM OLD.nx
       OR NEW.ny IS DISTINCT FROM OLD.ny
       OR NEW.page_index IS DISTINCT FROM OLD.page_index THEN
      v_action := 'moved';
      v_summary := format('%s moved %s on page %s',
        COALESCE(v_name,'System/User'),
        CASE WHEN v_is_marker THEN v_ref ELSE NEW.awp_class_name || ' marker ' || v_ref END,
        NEW.page_index);
      v_details := jsonb_build_object(
        'from', jsonb_build_object('nx', OLD.nx, 'ny', OLD.ny, 'page_index', OLD.page_index),
        'to',   jsonb_build_object('nx', NEW.nx, 'ny', NEW.ny, 'page_index', NEW.page_index)
      );

      SELECT id INTO v_recent
      FROM public.project_audit_events
      WHERE entity_type = 'annotation'
        AND entity_id = v_id
        AND action = 'moved'
        AND actor_user_id IS NOT DISTINCT FROM v_actor
        AND created_at > now() - interval '60 seconds'
      ORDER BY created_at DESC LIMIT 1;

      IF v_recent IS NOT NULL THEN
        UPDATE public.project_audit_events
        SET details = jsonb_set(details, '{to}', v_details->'to', true),
            summary = v_summary,
            created_at = now()
        WHERE id = v_recent;
        RETURN NEW;
      END IF;
    ELSE
      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO public.project_audit_events(
    project_id, actor_user_id, actor_email, actor_name,
    entity_type, entity_id, action, summary, details
  ) VALUES (
    v_project, v_actor, v_email, v_name,
    'annotation', v_id, v_action, v_summary, v_details
  );

  RETURN COALESCE(NEW, OLD);
END $$;