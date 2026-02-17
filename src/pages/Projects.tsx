import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useActivityLogger } from "@/hooks/useActivityLogger";
import { useHeapIdentify } from "@/hooks/useHeapIdentify";
import { getUserFriendlyError } from "@/lib/errorHandling";
import { formatDateShort } from "@/lib/reportGenerator";
import { AppHeader } from "@/components/AppHeader";
import { Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface Project {
  id: string;
  name: string;
  project_type: string;
  location: string;
  city: string;
  country: string;
  construction_start_date: string;
  created_at: string;
  user_id: string;
  status?: string;
}

interface ProjectWithCreator extends Project {
  creator_name: string;
  creator_email: string;
}

const capitalizeFirst = (str: string) => {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
};

const formatLocation = (city?: string, country?: string) => {
  const parts = [city, country].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "—";
};

const Projects = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  useHeapIdentify();
  const { logActivity } = useActivityLogger();
  const [projects, setProjects] = useState<ProjectWithCreator[]>([]);
  const [loading, setLoading] = useState(true);
  const [userProjectRoles, setUserProjectRoles] = useState<Map<string, string>>(new Map());
  const [showWelcome, setShowWelcome] = useState(() => 
    sessionStorage.getItem('riskblue_welcome_dismissed') !== 'true'
  );

  const handleDismissWelcome = () => {
    setShowWelcome(false);
    sessionStorage.setItem('riskblue_welcome_dismissed', 'true');
  };

  useEffect(() => {
    if (user) {
      fetchProjects();
    }
  }, [user]);

  const fetchProjects = async () => {
    try {
      // First fetch projects
      const { data: projectsData, error: projectsError } = await supabase
        .from("projects")
        .select("*")
        .order("created_at", { ascending: false });

      if (projectsError) throw projectsError;

      // Get unique user IDs
      const userIds = [...new Set((projectsData || []).map(p => p.user_id))];
      
      // Fetch profiles, roles, and emails in parallel for performance
      const [profilesResult, rolesResult, emailsResult] = await Promise.all([
        supabase
          .from("profiles")
          .select("user_id, display_name")
          .in("user_id", userIds),
        supabase
          .from("project_user_roles")
          .select("project_id, role")
          .eq("user_id", user!.id),
        supabase.functions.invoke(
          `get-user-emails?userIds=${userIds.join(",")}`,
          { method: "GET" }
        ).catch(() => ({ data: null }))
      ]);

      // Create a map of user_id to display_name
      const profilesMap = new Map(
        (profilesResult.data || []).map(p => [p.user_id, p.display_name])
      );

      // Create a map of project_id to role
      const rolesMap = new Map<string, string>(
        (rolesResult.data || []).map(r => [r.project_id, r.role])
      );
      setUserProjectRoles(rolesMap);

      // Create emails map
      const emailsMap = new Map<string, string>(
        emailsResult.data?.emails ? Object.entries(emailsResult.data.emails) : []
      );

      // Merge projects with creator names and emails
      // Use email prefix as fallback when display_name is null
      const projectsWithCreators: ProjectWithCreator[] = (projectsData || []).map(project => {
        const displayName = profilesMap.get(project.user_id);
        const email = emailsMap.get(project.user_id) || "";
        const fallbackName = email ? email.split('@')[0] : "Unknown";
        return {
          ...project,
          creator_name: displayName || fallbackName,
          creator_email: email
        };
      });

      setProjects(projectsWithCreators);
    } catch (error: any) {
      toast({
        title: "Error",
        description: getUserFriendlyError(error),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleNewProject = () => {
    logActivity("add_new_clicked");
    navigate("/project/new");
  };

  const handleDeleteProject = async (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (!confirm("Are you sure you want to delete this project?")) {
      return;
    }

    try {
      // Server-side role verification
      const { data: roleData, error: roleError } = await supabase
        .from("project_user_roles")
        .select("role")
        .eq("project_id", projectId)
        .eq("user_id", user?.id)
        .single();

      if (roleError || roleData?.role !== "admin") {
        toast({
          variant: "destructive",
          title: "Not authorized",
          description: "You must be a project admin to delete this project.",
        });
        return;
      }

      const { error } = await supabase
        .from("projects")
        .delete()
        .eq("id", projectId);

      if (error) throw error;

      // Log activity after successful deletion
      logActivity("project_deleted", projectId);

      toast({
        title: "Project deleted",
        description: "The project has been successfully deleted.",
      });

      fetchProjects();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error deleting project",
        description: getUserFriendlyError(error),
      });
    }
  };

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <AppHeader />

      <main className="container mx-auto px-6 py-8 flex-1 overflow-auto">
        <div className="mb-8">
          {showWelcome && (
            <div className="bg-muted/50 p-6 rounded-lg mb-6 relative">
              <button 
                onClick={handleDismissWelcome}
                className="absolute top-3 right-3 text-muted-foreground hover:text-foreground"
                aria-label="Dismiss welcome message"
              >
                <X className="h-4 w-4" />
              </button>
              <p className="text-sm text-foreground mb-3 pr-6">
                <strong>👋 Welcome to RiskBlue!</strong>
              </p>
              <p className="text-sm text-muted-foreground">
                RiskBlue helps builders identify project-specific water risks, determine the right mitigation strategies, and translate them into structured plans and coordinated execution. By unifying risk discovery, planning, and field operations, RiskBlue ensures consistent control, accountability, and rapid response across the entire water-mitigation lifecycle.
              </p>
            </div>
          )}

          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold text-foreground">
                Projects{projects.length > 3 && ` (${projects.length})`}
              </h1>
            </div>
            <div className="flex gap-3">
              <Button onClick={handleNewProject}>Add New Project</Button>
            </div>
          </div>
        </div>

        {loading || !user ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">Loading projects...</p>
          </div>
        ) : projects.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground mb-4">No projects yet</p>
            <Button onClick={handleNewProject}>Create your first project</Button>
          </div>
        ) : (
          <div className="bg-card rounded-lg border overflow-hidden">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr className="text-left">
                  <th className="px-6 py-3 text-sm font-medium text-foreground">
                    Project Name
                  </th>
                  <th className="px-6 py-3 text-sm font-medium text-foreground">Project Type</th>
                  <th className="px-6 py-3 text-sm font-medium text-foreground">Location</th>
                  <th className="px-6 py-3 text-sm font-medium text-foreground">Construction Start</th>
                  <th className="px-6 py-3 text-sm font-medium text-foreground">Created By</th>
                  <th className="px-6 py-3 text-sm font-medium text-foreground">Created On</th>
                  <th className="px-6 py-3 w-[80px]"></th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr
                    key={project.id}
                    className="border-t hover:bg-muted/30 cursor-pointer"
                    onClick={() => navigate(`/project/${project.id}`)}
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <span className="text-foreground">{project.name}</span>
                        <Badge
                          variant={project.status === "completed" ? "default" : "secondary"}
                          className="text-xs"
                        >
                          {project.status || "draft"}
                        </Badge>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-muted-foreground">{capitalizeFirst(project.project_type) || "—"}</td>
                    <td className="px-6 py-4 text-muted-foreground">{formatLocation(project.city, project.country)}</td>
                    <td className="px-6 py-4 text-muted-foreground">
                      {formatDateShort(project.construction_start_date)}
                    </td>
                    <td className="px-6 py-4 text-muted-foreground">
                      {project.creator_email ? (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-default">{project.creator_name}</span>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>{project.creator_email}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      ) : (
                        <span>{project.creator_name}</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-muted-foreground">
                      {formatDateShort(project.created_at)}
                    </td>
                    <td className="px-6 py-4">
                      <div className="h-9 flex items-center justify-center">
                        {userProjectRoles.get(project.id) === "admin" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => handleDeleteProject(project.id, e)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>

    </div>
  );
};

export default Projects;
