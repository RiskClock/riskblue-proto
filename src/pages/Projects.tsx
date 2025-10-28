import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import riskBlueLogo from "@/assets/riskblue-logo.png";
import { format } from "date-fns";

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
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleNewProject = () => {
    navigate("/project/new");
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <img src={riskBlueLogo} alt="RiskBlue" className="h-8" />
          <div className="flex items-center gap-6">
            <button className="text-foreground hover:text-primary">Projects</button>
            <button className="text-muted-foreground hover:text-foreground">Home</button>
            <Avatar className="cursor-pointer" onClick={signOut}>
              <AvatarFallback>{user?.email?.[0].toUpperCase()}</AvatarFallback>
            </Avatar>
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
              <strong>Welcome to RiskBlue.</strong>
            </p>
            <p className="text-sm text-muted-foreground mb-3">
              RiskBlue empowers insurance brokers to efficiently create cost-effective Water Mitigation
              Guidelines for High-Rise Builder's Risk underwriting, helping to assess and minimize
              water-related risks prior to the construction start. Our streamlined approach ensures that
              underwriters collaboratively choose with developers, contractors and carriers comprehensive,
              data-driven Control Measures, enabling better decision-making and risk control.
            </p>
            <p className="text-sm text-muted-foreground">
              To begin creating a Water Mitigation Guideline, click "New", and a step-by-step discovery
              process will guide you through each stage seamlessly. If you've already started a project,
              simply click "Open project" to resume where you left off, allowing you to review, update,
              or finalize your water mitigation guideline.
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
                  <th className="px-6 py-3 text-sm font-medium text-foreground">Stakeholders</th>
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
                      <div className="flex -space-x-2">
                        <Avatar className="w-8 h-8 border-2 border-background">
                          <AvatarFallback className="text-xs">{user?.email?.[0].toUpperCase()}</AvatarFallback>
                        </Avatar>
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
