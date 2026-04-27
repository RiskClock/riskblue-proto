ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;

CREATE INDEX IF NOT EXISTS profiles_company_idx ON public.profiles (company);
CREATE INDEX IF NOT EXISTS profiles_is_active_idx ON public.profiles (is_active);