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
import { Trash2, MessageSquare, LogOut } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { FieldAgentChat } from "@/components/FieldAgentChat";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ProviderSelectionDialog } from "@/components/ProviderSelectionDialog";

interface Project {
  id: string;
  name: string;
  project_type: string;
  location: string;
  construction_start_date: string;
}

const Projects = () => {
  const { user, signOut } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { toast } = useToast();
  const [chatOpen, setChatOpen] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [showProviderDialog, setShowProviderDialog] = useState(false);

  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    try {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setProjects(data || []);
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

  const handleOpenFieldAgent = (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedProjectId(projectId);
    setChatOpen(true);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <img src={riskBlueLogo} alt="RiskBlue" className="h-8" />
          <div className="flex items-center gap-6">
            <button className="text-foreground hover:text-primary">Projects</button>
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
              <p className="text-muted-foreground">{projects.length} result{projects.length !== 1 ? 's' : ''}</p>
            </div>
            <div className="flex gap-3">
              <Button variant="outline">Sort</Button>
              <Button variant="outline">Filter</Button>
              <Button onClick={handleNewProject}>New</Button>
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

        {loading ? (
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
                  <th className="px-6 py-3 text-sm font-medium text-foreground">Project Name</th>
                  <th className="px-6 py-3 text-sm font-medium text-foreground">Project Type</th>
                  <th className="px-6 py-3 text-sm font-medium text-foreground">Project Location</th>
                  <th className="px-6 py-3 text-sm font-medium text-foreground">Construction Start Date</th>
                  <th className="px-6 py-3 text-sm font-medium text-foreground">Status</th>
                  <th className="px-6 py-3 text-sm font-medium text-foreground">Stakeholders</th>
                  <th className="px-6 py-3 w-[120px]"></th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr
                    key={project.id}
                    className="border-t hover:bg-muted/30 cursor-pointer"
                    onClick={() => navigate(`/project/${project.id}`)}
                  >
                    <td className="px-6 py-4 text-foreground">{project.name}</td>
                    <td className="px-6 py-4 text-muted-foreground">{project.project_type || "—"}</td>
                    <td className="px-6 py-4 text-muted-foreground">{project.location || "—"}</td>
                    <td className="px-6 py-4 text-muted-foreground">
                      {project.construction_start_date
                        ? format(new Date(project.construction_start_date), "M/dd/yy")
                        : "—"}
                    </td>
                    <td className="px-6 py-4">
                      <Badge
                        variant={(project as any).status === "completed" ? "default" : "secondary"}
                      >
                        {(project as any).status || "draft"}
                      </Badge>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex -space-x-2">
                        <Avatar className="w-8 h-8 border-2 border-background">
                          <AvatarFallback className="text-xs">{user?.email?.[0].toUpperCase()}</AvatarFallback>
                        </Avatar>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => handleOpenFieldAgent(project.id, e)}
                          title="Open Field Agent"
                        >
                          <MessageSquare className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => handleDeleteProject(project.id, e)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {selectedProjectId && (
        <FieldAgentChat
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          projectId={selectedProjectId}
        />
      )}

      <ProviderSelectionDialog 
        open={showProviderDialog} 
        onOpenChange={setShowProviderDialog} 
      />
    </div>
  );
};

export default Projects;
