import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building2 } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { SolutionProviderPortalContent } from "@/components/wizard/SolutionProviderPortalContent";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { useHeapIdentify } from "@/hooks/useHeapIdentify";

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
  useHeapIdentify();
  const [searchParams, setSearchParams] = useSearchParams();
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [selectedCollaborator, setSelectedCollaborator] = useState<Collaborator | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(false);
  const [showProviderDialog, setShowProviderDialog] = useState(false);

  // Redirect non-internal users to projects page
  useEffect(() => {
    if (user && !user.email?.toLowerCase().endsWith("@riskclock.com")) {
      navigate("/projects");
    }
  }, [user, navigate]);

  // Auto-open dialog on mount if no params
  useEffect(() => {
    const collaboratorId = searchParams.get("collaborator");
    const projectId = searchParams.get("project");
    
    if (collaboratorId && projectId) {
      loadCollaboratorAndProject(collaboratorId, projectId);
    } else if (collaboratorId) {
      // Load collaborator and show their projects
      loadCollaboratorOnly(collaboratorId);
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
        .maybeSingle();

      if (collabError) throw collabError;
      if (!collaborator) return;

      const { data: project, error: projectError } = await supabase
        .from("projects")
        .select("*")
        .eq("id", projectId)
        .maybeSingle();

      if (projectError) throw projectError;
      if (!project) return;

      setSelectedCollaborator(collaborator);
      setSelectedProject(project);
      
      // Also load the projects list for back navigation
      await loadProjectsForCollaborator(collaborator);
    } catch (error) {
      console.error("Error loading data:", error);
    }
  };

  const loadCollaboratorOnly = async (collaboratorId: string) => {
    try {
      const { data: collaborator, error: collabError } = await supabase
        .from("project_collaborators")
        .select("*")
        .eq("id", collaboratorId)
        .maybeSingle();

      if (collabError) throw collabError;
      if (!collaborator) return;

      setSelectedCollaborator(collaborator);
      await loadProjectsForCollaborator(collaborator);
    } catch (error) {
      console.error("Error loading collaborator:", error);
    }
  };

  const loadProjectsForCollaborator = async (collaborator: Collaborator) => {
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
    setShowProviderDialog(false);
    setSearchParams({ collaborator: collaboratorId });

    await loadProjectsForCollaborator(collaborator);
  };

  const handleProjectSelect = (projectId: string) => {
    const project = projects.find(p => p.id === projectId);
    if (project) {
      setSelectedProject(project);
      setSearchParams({ collaborator: selectedCollaborator!.id, project: projectId });
    }
  };

  const handleBack = () => {
    if (selectedProject) {
      // Go back to projects list
      setSelectedProject(null);
      setSearchParams({ collaborator: selectedCollaborator!.id });
    } else {
      navigate(-1);
    }
  };

  const handleExitPortal = () => {
    navigate("/projects");
  };

  const handleProviderSelection = (collaboratorId: string) => {
    handleCollaboratorSelect(collaboratorId);
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />

      <main className="container mx-auto px-6 py-8">
        {selectedProject && selectedCollaborator ? (
          <div className="max-w-6xl mx-auto">
            <div className="mb-4">
              <p className="text-sm text-muted-foreground">
                Viewing as: {selectedCollaborator.name} ({selectedCollaborator.email}) • {selectedCollaborator.company}
              </p>
            </div>
            <SolutionProviderPortalContent
              key={`${selectedProject.id}-${selectedCollaborator.id}`}
              projectId={selectedProject.id}
              collaboratorId={selectedCollaborator.id}
              providerName={selectedCollaborator.name}
              companyName={selectedCollaborator.company}
            />
          </div>
        ) : selectedCollaborator && projects.length > 0 ? (
          <div className="max-w-4xl mx-auto space-y-6">
            <div>
              <h1 className="text-3xl font-bold mb-2">
                Projects for {selectedCollaborator.company}
              </h1>
              <p className="text-muted-foreground">
                Viewing as: {selectedCollaborator.name} ({selectedCollaborator.email})
              </p>
            </div>

            <div className="grid gap-4">
              {projects.map((project) => (
                <Card
                  key={project.id}
                  className="cursor-pointer hover:border-primary transition-colors"
                  onClick={() => handleProjectSelect(project.id)}
                >
                  <CardContent className="flex items-center justify-between p-6">
                    <div className="flex items-center gap-4">
                      <div className="h-12 w-12 bg-primary/10 rounded-lg flex items-center justify-center">
                        <Building2 className="h-6 w-6 text-primary" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-lg">{project.name}</h3>
                        <p className="text-sm text-muted-foreground">
                          {project.location || "No location specified"}
                        </p>
                      </div>
                    </div>
                    <Badge variant="secondary">{project.project_type || "N/A"}</Badge>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ) : null}
      </main>

      {/* Provider Selection Dialog */}
      <Dialog open={showProviderDialog} onOpenChange={(open) => {
        setShowProviderDialog(open);
        if (!open && !selectedCollaborator) {
          navigate(-1);
        }
      }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Select Solution Provider</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div>
              <Label>Solution Provider</Label>
              <Select onValueChange={handleCollaboratorSelect}>
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
        </DialogContent>
      </Dialog>
    </div>
  );
}
