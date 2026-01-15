-- Drop existing constraints first (if they exist), then recreate with CASCADE DELETE
-- user_drive_tokens already has a constraint, need to drop it first
ALTER TABLE public.user_drive_tokens DROP CONSTRAINT IF EXISTS user_drive_tokens_user_id_fkey;
ALTER TABLE public.user_drive_tokens
ADD CONSTRAINT user_drive_tokens_user_id_fkey
FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- user_roles - drop if exists and recreate
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_user_id_fkey;
ALTER TABLE public.user_roles
ADD CONSTRAINT user_roles_user_id_fkey
FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;