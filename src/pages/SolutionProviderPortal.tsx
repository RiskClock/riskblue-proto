import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Building2, LogOut } from "lucide-react";
import riskBlueLogo from "@/assets/riskblue-logo.jpg";
import { SolutionProviderPortalContent } from "@/components/wizard/SolutionProviderPortalContent";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";

interface Collaborator {
  id: string;
  name: string;
  email: string;
  company: string;
  project_id: string;
}

interface Project {
  id: string;
  name: string;
  location: string;
  project_type: string;
}

export default function SolutionProviderPortal() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [selectedCollaborator, setSelectedCollaborator] = useState<Collaborator | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(false);
  const [showProviderDialog, setShowProviderDialog] = useState(false);

  // Auto-open dialog on mount if no params
  useEffect(() => {
    const collaboratorId = searchParams.get("collaborator");
    const projectId = searchParams.get("project");
    
    if (collaboratorId && projectId) {
      loadCollaboratorAndProject(collaboratorId, projectId);
    } else {
      fetchAllCollaborators();
      setShowProviderDialog(true);
    }
  }, []);

  const loadCollaboratorAndProject = async (collaboratorId: string, projectId: string) => {
    try {
      const { data: collaborator, error: collabError } = await supabase
        .from("project_collaborators")
        .select("*")
        .eq("id", collaboratorId)
        .single();

      if (collabError) throw collabError;

      const { data: project, error: projectError } = await supabase
        .from("projects")
        .select("*")
        .eq("id", projectId)
        .single();

      if (projectError) throw projectError;

      setSelectedCollaborator(collaborator);
      setSelectedProject(project);
    } catch (error) {
      console.error("Error loading data:", error);
    }
  };

  const fetchAllCollaborators = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("project_collaborators")
        .select("*")
        .order("company", { ascending: true });

      if (error) throw error;
      setCollaborators(data || []);
    } catch (error) {
      console.error("Error fetching collaborators:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleCollaboratorSelect = async (collaboratorId: string) => {
    const collaborator = collaborators.find(c => c.id === collaboratorId);
    if (!collaborator) return;

    setSelectedCollaborator(collaborator);

    // Fetch all projects for this collaborator's company
    try {
      const { data, error } = await supabase
        .from("project_collaborators")
        .select("project_id")
        .eq("company", collaborator.company);

      if (error) throw error;

      const projectIds = data.map(d => d.project_id);
      
      const { data: projectsData, error: projectsError } = await supabase
        .from("projects")
        .select("*")
        .in("id", projectIds);

      if (projectsError) throw projectsError;

      setProjects(projectsData || []);
    } catch (error) {
      console.error("Error fetching projects:", error);
    }
  };

  const handleProjectSelect = (projectId: string) => {
    const project = projects.find(p => p.id === projectId);
    if (project) {
      setSelectedProject(project);
      setSearchParams({ collaborator: selectedCollaborator!.id, project: projectId });
      setShowProviderDialog(false);
    }
  };

  const handleBack = () => {
    navigate(-1);
  };

  const handleExitPortal = () => {
    setSelectedProject(null);
    setSelectedCollaborator(null);
    setProjects([]);
    setSearchParams({});
    navigate(-1);
  };

  const handleProviderSelection = (collaboratorId: string) => {
    handleCollaboratorSelect(collaboratorId);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b bg-card">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <img src={riskBlueLogo} alt="RiskBlue" className="h-8 cursor-pointer" onClick={() => navigate("/projects")} />
          <div className="flex items-center gap-6">
            <button onClick={() => navigate("/projects")} className="text-foreground hover:text-primary">
              Projects
            </button>
            <button onClick={handleExitPortal} className="text-foreground hover:text-primary">
              Exit Portal
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
        {selectedProject && selectedCollaborator && (
          <div className="max-w-6xl mx-auto">
            <div className="mb-4">
              <p className="text-sm text-muted-foreground">
                Viewing as: {selectedCollaborator.name} ({selectedCollaborator.email}) • {selectedCollaborator.company}
              </p>
            </div>
            <SolutionProviderPortalContent
              projectId={selectedProject.id}
              providerName={selectedCollaborator.name}
              companyName={selectedCollaborator.company}
            />
          </div>
        )}
      </main>

      {/* Provider Selection Dialog */}
      <Dialog open={showProviderDialog} onOpenChange={(open) => {
        setShowProviderDialog(open);
        if (!open && !selectedProject && !selectedCollaborator) {
          // If dialog is closed without selection, navigate back
          navigate(-1);
        }
      }}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Select Solution Provider & Project</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-6 py-4">
            {!selectedCollaborator ? (
              <div className="space-y-4">
                <div>
                  <Label>Solution Provider</Label>
                  <Select onValueChange={handleProviderSelection}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a provider..." />
                    </SelectTrigger>
                    <SelectContent>
                      {collaborators.map((collab) => (
                        <SelectItem key={collab.id} value={collab.id}>
                          <div className="flex flex-col items-start">
                            <span className="font-medium">{collab.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {collab.email} • {collab.company}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Selected Provider:</p>
                    <p className="text-sm text-muted-foreground">
                      {selectedCollaborator.name} • {selectedCollaborator.company}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSelectedCollaborator(null);
                      setProjects([]);
                    }}
                  >
                    Change
                  </Button>
                </div>

                <div>
                  <Label className="mb-2 block">Select Project</Label>
                  <div className="grid gap-3">
                    {projects.map((project) => (
                      <Card
                        key={project.id}
                        className="cursor-pointer hover:border-primary transition-colors"
                        onClick={() => handleProjectSelect(project.id)}
                      >
                        <CardContent className="flex items-center justify-between p-4">
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 bg-primary/10 rounded-lg flex items-center justify-center">
                              <Building2 className="h-5 w-5 text-primary" />
                            </div>
                            <div>
                              <h3 className="font-semibold">{project.name}</h3>
                              <p className="text-xs text-muted-foreground">
                                {project.location || "No location specified"}
                              </p>
                            </div>
                          </div>
                          <Badge variant="secondary" className="text-xs">
                            {project.project_type || "N/A"}
                          </Badge>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
