-- Enable pgcrypto extension for encryption
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Add columns for encrypted tokens and encryption indicator
ALTER TABLE public.user_drive_tokens 
ADD COLUMN IF NOT EXISTS encrypted_access_token text,
ADD COLUMN IF NOT EXISTS encrypted_refresh_token text,
ADD COLUMN IF NOT EXISTS is_encrypted boolean DEFAULT false;

-- Clear any plain-text tokens from the table (they will need to be re-authenticated)
-- This is a security measure - we're removing unencrypted tokens
UPDATE public.user_drive_tokens 
SET 
  access_token = 'ENCRYPTED',
  refresh_token = 'ENCRYPTED'
WHERE (is_encrypted = false OR is_encrypted IS NULL)
  AND access_token IS NOT NULL 
  AND access_token != ''
  AND access_token != 'ENCRYPTED';