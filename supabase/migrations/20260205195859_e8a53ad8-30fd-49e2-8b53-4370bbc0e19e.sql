-- Create a trigger function to block qbo user activity logs
CREATE OR REPLACE FUNCTION public.prevent_qbo_activity_logs()
RETURNS TRIGGER AS $$
DECLARE
  user_email TEXT;
BEGIN
  -- Get the email for this user from auth.users
  SELECT email INTO user_email 
  FROM auth.users 
  WHERE id = NEW.user_id;
  
  -- Skip insert if email contains 'qbo'
  IF user_email ILIKE '%qbo%' THEN
    RETURN NULL; -- Silently reject the insert
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Attach trigger to user_activity_logs table
CREATE TRIGGER check_qbo_activity_logs
  BEFORE INSERT ON public.user_activity_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_qbo_activity_logs();