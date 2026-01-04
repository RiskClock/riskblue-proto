-- Create project_role enum
CREATE TYPE public.project_role AS ENUM ('admin', 'contributor');

-- Create project_user_roles table (links users to projects with roles)
CREATE TABLE public.project_user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role public.project_role NOT NULL DEFAULT 'contributor',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, user_id)
);

-- Create project_invitations table (stores pending invitations)
CREATE TABLE public.project_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  role public.project_role NOT NULL DEFAULT 'contributor',
  token UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  invited_by UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, email)
);

-- Enable RLS on both tables
ALTER TABLE public.project_user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_invitations ENABLE ROW LEVEL SECURITY;

-- Create security definer function to check project roles (avoids RLS recursion)
CREATE OR REPLACE FUNCTION public.has_project_role(_user_id UUID, _project_id UUID, _role public.project_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.project_user_roles
    WHERE user_id = _user_id
      AND project_id = _project_id
      AND role = _role
  )
$$;

-- Create function to check if user has any role in project
CREATE OR REPLACE FUNCTION public.is_project_member(_user_id UUID, _project_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.project_user_roles
    WHERE user_id = _user_id
      AND project_id = _project_id
  )
$$;

-- RLS Policies for project_user_roles
CREATE POLICY "Users can view roles for projects they are members of"
ON public.project_user_roles
FOR SELECT
USING (public.is_project_member(auth.uid(), project_id));

CREATE POLICY "Project admins can insert roles"
ON public.project_user_roles
FOR INSERT
WITH CHECK (public.has_project_role(auth.uid(), project_id, 'admin'));

CREATE POLICY "Project admins can update roles"
ON public.project_user_roles
FOR UPDATE
USING (public.has_project_role(auth.uid(), project_id, 'admin'));

CREATE POLICY "Project admins can delete roles"
ON public.project_user_roles
FOR DELETE
USING (public.has_project_role(auth.uid(), project_id, 'admin'));

-- RLS Policies for project_invitations
CREATE POLICY "Project admins can view invitations"
ON public.project_invitations
FOR SELECT
USING (public.has_project_role(auth.uid(), project_id, 'admin'));

CREATE POLICY "Project admins can insert invitations"
ON public.project_invitations
FOR INSERT
WITH CHECK (public.has_project_role(auth.uid(), project_id, 'admin'));

CREATE POLICY "Project admins can update invitations"
ON public.project_invitations
FOR UPDATE
USING (public.has_project_role(auth.uid(), project_id, 'admin'));

CREATE POLICY "Project admins can delete invitations"
ON public.project_invitations
FOR DELETE
USING (public.has_project_role(auth.uid(), project_id, 'admin'));

-- Create trigger function to auto-assign project owner as admin
CREATE OR REPLACE FUNCTION public.assign_project_owner_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.project_user_roles (project_id, user_id, role)
  VALUES (NEW.id, NEW.user_id, 'admin');
  RETURN NEW;
END;
$$;

-- Create trigger on projects table
CREATE TRIGGER on_project_created
AFTER INSERT ON public.projects
FOR EACH ROW
EXECUTE FUNCTION public.assign_project_owner_admin();

-- Backfill existing projects: add admin role for project owners who don't have one
INSERT INTO public.project_user_roles (project_id, user_id, role)
SELECT id, user_id, 'admin'
FROM public.projects p
WHERE NOT EXISTS (
  SELECT 1 FROM public.project_user_roles pur
  WHERE pur.project_id = p.id AND pur.user_id = p.user_id
);