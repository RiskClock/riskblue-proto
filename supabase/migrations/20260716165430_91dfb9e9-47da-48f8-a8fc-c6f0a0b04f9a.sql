
-- Audit table
CREATE TABLE public.project_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  actor_user_id uuid,
  actor_email text,
  actor_name text,
  entity_type text NOT NULL,
  entity_id text,
  action text NOT NULL,
  summary text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.project_audit_events TO authenticated;
GRANT ALL ON public.project_audit_events TO service_role;

ALTER TABLE public.project_audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Internal users can view project audit events"
  ON public.project_audit_events
  FOR SELECT
  TO authenticated
  USING (public.is_internal_user(auth.uid()));

CREATE INDEX idx_audit_project_created ON public.project_audit_events(project_id, created_at DESC);
CREATE INDEX idx_audit_entity ON public.project_audit_events(entity_type, entity_id);
CREATE INDEX idx_audit_created ON public.project_audit_events(created_at DESC);

-- Trigger function: drawing_instances
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

  IF TG_OP = 'INSERT' THEN
    v_action := 'created';
    v_id := NEW.id::text;
    v_label := NEW.awp_class_name ||
      CASE WHEN NEW.instance_number IS NOT NULL
           THEN ' [' || NEW.awp_class_name || '-' || NEW.instance_number || ']'
           ELSE '' END;
    v_summary := format('%s added a new %s marker on page %s',
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
    v_summary := format('%s deleted %s marker [%s-%s] from page %s',
      COALESCE(v_name, 'System/User'),
      OLD.awp_class_name,
      OLD.awp_class_name,
      COALESCE(OLD.instance_number::text, '?'),
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
      v_summary := format('%s updated annotation [%s-%s]: Changed Asset Class from %s to %s',
        COALESCE(v_name, 'System/User'),
        NEW.awp_class_name,
        COALESCE(NEW.instance_number::text, '?'),
        OLD.awp_class_name, NEW.awp_class_name);
      v_details := jsonb_build_object('field', 'awp_class_name',
        'from', OLD.awp_class_name, 'to', NEW.awp_class_name);

    ELSIF NEW.metadata IS DISTINCT FROM OLD.metadata THEN
      v_action := 'field_changed';
      IF COALESCE(NEW.metadata->>'pipe_diameter','') IS DISTINCT FROM COALESCE(OLD.metadata->>'pipe_diameter','') THEN
        v_summary := format('%s updated annotation [%s-%s]: Changed Pipe Diameter from %s to %s',
          COALESCE(v_name,'System/User'), NEW.awp_class_name,
          COALESCE(NEW.instance_number::text,'?'),
          COALESCE(OLD.metadata->>'pipe_diameter','—'),
          COALESCE(NEW.metadata->>'pipe_diameter','—'));
      ELSIF COALESCE(NEW.metadata->>'pipe_type','') IS DISTINCT FROM COALESCE(OLD.metadata->>'pipe_type','') THEN
        v_summary := format('%s updated annotation [%s-%s]: Changed Pipe Type from %s to %s',
          COALESCE(v_name,'System/User'), NEW.awp_class_name,
          COALESCE(NEW.instance_number::text,'?'),
          COALESCE(OLD.metadata->>'pipe_type','—'),
          COALESCE(NEW.metadata->>'pipe_type','—'));
      ELSE
        v_summary := format('%s updated annotation [%s-%s]: metadata changed',
          COALESCE(v_name,'System/User'), NEW.awp_class_name,
          COALESCE(NEW.instance_number::text,'?'));
      END IF;
      v_details := jsonb_build_object('from', OLD.metadata, 'to', NEW.metadata);

    ELSIF NEW.nx IS DISTINCT FROM OLD.nx
       OR NEW.ny IS DISTINCT FROM OLD.ny
       OR NEW.page_index IS DISTINCT FROM OLD.page_index THEN
      v_action := 'moved';
      v_summary := format('%s moved %s marker [%s-%s] on page %s',
        COALESCE(v_name,'System/User'),
        NEW.awp_class_name, NEW.awp_class_name,
        COALESCE(NEW.instance_number::text,'?'),
        NEW.page_index);
      v_details := jsonb_build_object(
        'from', jsonb_build_object('nx', OLD.nx, 'ny', OLD.ny, 'page_index', OLD.page_index),
        'to',   jsonb_build_object('nx', NEW.nx, 'ny', NEW.ny, 'page_index', NEW.page_index)
      );

      -- Debounce: coalesce with a prior 'moved' event by same actor in last 60s
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

DROP TRIGGER IF EXISTS audit_drawing_instances_trg ON public.drawing_instances;
CREATE TRIGGER audit_drawing_instances_trg
AFTER INSERT OR UPDATE OR DELETE ON public.drawing_instances
FOR EACH ROW EXECUTE FUNCTION public.audit_drawing_instances();

-- Trigger function: projects (spatial levels + status)
CREATE OR REPLACE FUNCTION public.audit_project_spatial()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_email text;
  v_name text;
  v_old jsonb;
  v_new jsonb;
  v_old_map jsonb := '{}'::jsonb;
  v_new_map jsonb := '{}'::jsonb;
  r jsonb;
  v_key text;
BEGIN
  IF v_actor IS NOT NULL THEN
    SELECT email, COALESCE(raw_user_meta_data->>'display_name', email)
    INTO v_email, v_name
    FROM auth.users WHERE id = v_actor;
  END IF;

  IF NEW.workbench_status IS DISTINCT FROM OLD.workbench_status THEN
    INSERT INTO public.project_audit_events(
      project_id, actor_user_id, actor_email, actor_name,
      entity_type, entity_id, action, summary, details
    ) VALUES (
      NEW.id, v_actor, v_email, v_name,
      'project_status', NEW.id::text, 'status_changed',
      format('%s changed project status from %s to %s',
        COALESCE(v_name,'System/User'),
        COALESCE(OLD.workbench_status,'—'),
        COALESCE(NEW.workbench_status,'—')),
      jsonb_build_object('from', OLD.workbench_status, 'to', NEW.workbench_status)
    );
  END IF;

  v_old := COALESCE(OLD.project_data->'spatial_records', '[]'::jsonb);
  v_new := COALESCE(NEW.project_data->'spatial_records', '[]'::jsonb);

  IF v_old = v_new THEN
    RETURN NEW;
  END IF;

  FOR r IN SELECT value FROM jsonb_array_elements(v_old) AS value LOOP
    v_key := COALESCE(r->>'id', r->>'name');
    IF v_key IS NOT NULL THEN
      v_old_map := v_old_map || jsonb_build_object(v_key, r);
    END IF;
  END LOOP;
  FOR r IN SELECT value FROM jsonb_array_elements(v_new) AS value LOOP
    v_key := COALESCE(r->>'id', r->>'name');
    IF v_key IS NOT NULL THEN
      v_new_map := v_new_map || jsonb_build_object(v_key, r);
    END IF;
  END LOOP;

  FOR v_key IN SELECT jsonb_object_keys(v_new_map) LOOP
    IF v_old_map ? v_key THEN
      IF v_old_map->v_key IS DISTINCT FROM v_new_map->v_key THEN
        INSERT INTO public.project_audit_events(
          project_id, actor_user_id, actor_email, actor_name,
          entity_type, entity_id, action, summary, details
        ) VALUES (
          NEW.id, v_actor, v_email, v_name,
          'spatial_level', v_key, 'level_updated',
          format('%s updated spatial level "%s"',
            COALESCE(v_name,'System/User'),
            COALESCE(v_new_map->v_key->>'name', v_key)),
          jsonb_build_object('from', v_old_map->v_key, 'to', v_new_map->v_key)
        );
      END IF;
    ELSE
      INSERT INTO public.project_audit_events(
        project_id, actor_user_id, actor_email, actor_name,
        entity_type, entity_id, action, summary, details
      ) VALUES (
        NEW.id, v_actor, v_email, v_name,
        'spatial_level', v_key, 'level_added',
        format('%s added spatial level "%s"',
          COALESCE(v_name,'System/User'),
          COALESCE(v_new_map->v_key->>'name', v_key)),
        jsonb_build_object('level', v_new_map->v_key)
      );
    END IF;
  END LOOP;

  FOR v_key IN SELECT jsonb_object_keys(v_old_map) LOOP
    IF NOT (v_new_map ? v_key) THEN
      INSERT INTO public.project_audit_events(
        project_id, actor_user_id, actor_email, actor_name,
        entity_type, entity_id, action, summary, details
      ) VALUES (
        NEW.id, v_actor, v_email, v_name,
        'spatial_level', v_key, 'level_removed',
        format('%s removed spatial level "%s"',
          COALESCE(v_name,'System/User'),
          COALESCE(v_old_map->v_key->>'name', v_key)),
        jsonb_build_object('level', v_old_map->v_key)
      );
    END IF;
  END LOOP;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS audit_project_spatial_trg ON public.projects;
CREATE TRIGGER audit_project_spatial_trg
AFTER UPDATE ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.audit_project_spatial();
