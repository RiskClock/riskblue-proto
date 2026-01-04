import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

type ProjectRole = "admin" | "contributor" | null;

interface UseProjectRoleResult {
  role: ProjectRole;
  loading: boolean;
  isAdmin: boolean;
  isContributor: boolean;
  refetch: () => Promise<void>;
}

export const useProjectRole = (projectId: string | undefined): UseProjectRoleResult => {
  const { user } = useAuth();
  const [role, setRole] = useState<ProjectRole>(null);
  const [loading, setLoading] = useState(true);

  const fetchRole = async () => {
    if (!projectId || !user?.id) {
      setRole(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("project_user_roles")
        .select("role")
        .eq("project_id", projectId)
        .eq("user_id", user.id)
        .single();

      if (error) {
        console.error("Error fetching project role:", error);
        setRole(null);
      } else {
        setRole(data?.role as ProjectRole);
      }
    } catch (err) {
      console.error("Error in useProjectRole:", err);
      setRole(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRole();
  }, [projectId, user?.id]);

  return {
    role,
    loading,
    isAdmin: role === "admin",
    isContributor: role === "contributor",
    refetch: fetchRole,
  };
};
