DO $$
DECLARE
  v_project_id uuid := '86ab9e72-0434-4ca4-bc8c-e09047475a2a';
  v_old_owner uuid;
  v_new_owner uuid;
BEGIN
  SELECT id INTO v_new_owner FROM auth.users WHERE email = 'demo+connectedsensors@riskclock.com';
  IF v_new_owner IS NULL THEN
    RAISE EXCEPTION 'New owner user not found';
  END IF;

  SELECT user_id INTO v_old_owner FROM public.projects WHERE id = v_project_id;

  UPDATE public.projects SET user_id = v_new_owner WHERE id = v_project_id;

  -- Ensure new owner has admin role on the project
  INSERT INTO public.project_user_roles (project_id, user_id, role)
  VALUES (v_project_id, v_new_owner, 'admin')
  ON CONFLICT (project_id, user_id) DO UPDATE SET role = 'admin';

  -- Remove old owner's role on the project
  IF v_old_owner IS NOT NULL AND v_old_owner <> v_new_owner THEN
    DELETE FROM public.project_user_roles WHERE project_id = v_project_id AND user_id = v_old_owner;
  END IF;
END $$;