CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name, account_type)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'display_name', new.raw_user_meta_data->>'full_name'),
    CASE WHEN new.raw_user_meta_data->>'signup_method' IN ('email_signup','autodesk','procore') THEN 'developer' ELSE NULL END
  );
  RETURN new;
END;
$$;
