import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { getUserFriendlyError } from "@/lib/errorHandling";
import riskBlueLogo from "@/assets/riskblue-logo.jpg";
import { format } from "date-fns";
import { Trash2, LogOut } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ProviderSelectionDialog } from "@/components/ProviderSelectionDialog";

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
  const { user, signOut } = useAuth();
  const [projects, setProjects] = useState<ProjectWithCreator[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { toast } = useToast();
  const [showProviderDialog, setShowProviderDialog] = useState(false);

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
      
      // Fetch profiles for those users
      const { data: profilesData } = await supabase
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", userIds);

      // Create a map of user_id to display_name
      const profilesMap = new Map(
        (profilesData || []).map(p => [p.user_id, p.display_name])
      );

      // Merge projects with creator names
      const projectsWithCreators: ProjectWithCreator[] = (projectsData || []).map(project => ({
        ...project,
        creator_name: profilesMap.get(project.user_id) || "Unknown"
      }));

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
    navigate("/project/new");
  };

  const handleDeleteProject = async (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (!confirm("Are you sure you want to delete this project?")) {
      return;
    }

    try {
      const { error } = await supabase
        .from("projects")
        .delete()
        .eq("id", projectId);

      if (error) throw error;

      toast({
        title: "Project deleted",
        description: "The project has been successfully deleted.",
      });

      fetchProjects();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error deleting project",
        description: error.message,
      });
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <img src={riskBlueLogo} alt="RiskBlue" className="h-8" />
          <div className="flex items-center gap-6">
            <button className="text-primary font-medium">Projects</button>
            {user?.email?.endsWith("@riskclock.com") && (
              <button onClick={() => navigate("/configuration")} className="text-foreground hover:text-primary">
                Configuration
              </button>
            )}
            <button onClick={() => setShowProviderDialog(true)} className="text-foreground hover:text-primary">
              Solution Provider Portal
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Avatar className="cursor-pointer">
                  <AvatarFallback>{user?.email?.[0].toUpperCase()}</AvatarFallback>
                </Avatar>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={signOut} className="cursor-pointer">
                  <LogOut className="h-4 w-4 mr-2" />
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold text-foreground">Projects</h1>
            </div>
            <div className="flex gap-3">
              <Button onClick={handleNewProject}>Add New Project</Button>
            </div>
          </div>

          <div className="bg-muted/50 p-6 rounded-lg mb-6">
            <p className="text-sm text-foreground mb-3">
              <strong>Welcome to RiskBlue!</strong>
            </p>
            <p className="text-sm text-muted-foreground mb-3">
              RiskBlue helps builders identify project-specific water risks, determine the right mitigation strategies, and translate them into structured plans and coordinated execution. By unifying risk discovery, planning, and field operations, RiskBlue ensures consistent control, accountability, and rapid response across the entire water-mitigation lifecycle.
            </p>
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
                    Project Name ({projects.length})
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
                      {project.construction_start_date
                        ? format(new Date(project.construction_start_date), "M/dd/yy")
                        : "—"}
                    </td>
                    <td className="px-6 py-4 text-muted-foreground">{project.creator_name}</td>
                    <td className="px-6 py-4 text-muted-foreground">
                      {project.created_at
                        ? format(new Date(project.created_at), "M/dd/yy")
                        : "—"}
                    </td>
                    <td className="px-6 py-4">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => handleDeleteProject(project.id, e)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>

      <ProviderSelectionDialog 
        open={showProviderDialog} 
        onOpenChange={setShowProviderDialog} 
      />
    </div>
  );
};

export default Projects;
