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
import { Trash2, X, Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CreateProjectModal } from "@/components/CreateProjectModal";
import { useAccountType } from "@/hooks/useAccountType";
import { useTenant } from "@/contexts/TenantContext";

interface Project {
  id: string;
  name: string;
  created_at: string;
  user_id: string;
  status?: string;
  credits_consumed?: number | null;
  report_file_path?: string | null;
  report_file_name?: string | null;
  workbench_status?: string | null;
}

interface ProjectWithCreator extends Project {
  creator_name: string;
  creator_email: string;
}

const PROJECT_PAGE_SIZE = 50;

const Projects = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { isWMSV } = useAccountType();
  const { tenantId, tenantPath, hasPermission } = useTenant();
  const canCreateProject = tenantId ? hasPermission("create_project") : true;
  const canDeleteProject = tenantId ? hasPermission("delete_project") : true;
  useHeapIdentify();
  const { logActivity } = useActivityLogger();
  const [projects, setProjects] = useState<ProjectWithCreator[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
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
      fetchProjects({ reset: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, tenantId]);


  const fetchProjects = async ({ reset = false }: { reset?: boolean } = {}) => {
    if (!user?.id) return;
    const offset = reset ? 0 : projects.length;
    try {
      if (reset) setLoading(true);
      else setLoadingMore(true);

      const { data, error } = await supabase.rpc("get_project_list_summaries", {
        p_limit: PROJECT_PAGE_SIZE,
        p_offset: offset,
        p_tenant_id: tenantId,
      } as any);

      if (error) throw error;

      const nextProjects: ProjectWithCreator[] = (data || []).map((project) => ({
        id: project.id,
        name: project.name,
        created_at: project.created_at,
        user_id: project.user_id,
        status: project.status,
        credits_consumed: project.credits_consumed,
        report_file_path: project.report_file_path,
        report_file_name: project.report_file_name,
        workbench_status: project.workbench_status,
        creator_name: project.creator_name || "Unknown",
        creator_email: project.creator_email || "",
      }));

      const roleEntries = (data || [])
        .filter((row) => row.user_role)
        .map((row) => [row.id, row.user_role as string] as const);

      setUserProjectRoles((prev) => {
        const next = reset ? new Map<string, string>() : new Map(prev);
        roleEntries.forEach(([id, role]) => next.set(id, role));
        return next;
      });
      setProjects((prev) => (reset ? nextProjects : [...prev, ...nextProjects]));
      setHasMore((data || []).length === PROJECT_PAGE_SIZE);
    } catch (error: any) {
      toast({
        title: "Error",
        description: getUserFriendlyError(error),
        variant: "destructive",
      });
    } finally {
      if (reset) setLoading(false);
      setLoadingMore(false);
    }
  };

  const handleNewProject = () => {
    logActivity("add_new_clicked");
    setShowCreateModal(true);
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

      fetchProjects({ reset: true });
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
      <AppHeader
        title={`Projects${projects.length > 3 ? ` (${projects.length})` : ""}`}
        infoTitle="About Projects"
        infoContent={
          <p>
            RiskBlue helps builders identify project-specific water risks, determine the right mitigation strategies, and translate them into structured plans and coordinated execution.
          </p>
        }
      />


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
        </div>


        {loading || !user ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">Loading projects...</p>
          </div>
        ) : projects.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground mb-4">No projects yet</p>
            {canCreateProject && (
              <Button onClick={handleNewProject}>Create your first project</Button>
            )}
          </div>
        ) : (
          <div className="bg-card rounded-lg border overflow-hidden">
            <table className="w-full">
              <thead className="bg-muted/50 [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-muted [&_th]:shadow-[inset_0_-1px_0_hsl(var(--border))]">
                <tr className="text-left">
                  <th className="px-6 py-3 text-sm font-medium text-foreground">Project Name</th>
                  <th className="px-6 py-3 text-sm font-medium text-foreground">Status</th>
                  <th className="px-6 py-3 text-sm font-medium text-foreground">Created By</th>
                  <th className="px-6 py-3 text-sm font-medium text-foreground">Created On</th>
                  <th className="px-6 py-3 text-sm font-medium text-foreground">Credit Cost</th>
                  <th className="px-6 py-3 w-[120px]"></th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr
                    key={project.id}
                    className="border-t hover:bg-muted/30 cursor-pointer"
                    onClick={() =>
                      navigate(
                        tenantPath(
                          isWMSV
                            ? `/workbench/project/${project.id}`
                            : `/project/${project.id}`,
                        ),
                      )
                    }
                  >
                    <td className="px-6 py-4">
                      <span className="text-foreground">{project.name}</span>
                    </td>
                    <td className="px-6 py-4">
                      {(() => {
                        const s = (project.workbench_status || "processing") as "processing" | "processed";
                        const cls =
                          s === "processed"
                            ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                            : "bg-amber-100 text-amber-800 border-amber-300";
                        const label = s === "processed" ? "Processed" : "Processing";
                        return (
                          <Badge variant="outline" className={cls}>
                            {label}
                          </Badge>
                        );
                      })()}
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
                    <td className="px-6 py-4 text-muted-foreground tabular-nums">
                      {typeof project.credits_consumed === "number" ? project.credits_consumed : "-"}
                    </td>
                    <td className="px-6 py-4">
                      <div className="h-9 flex items-center justify-end gap-1">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  disabled={!project.report_file_path}
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    if (!project.report_file_path) return;
                                    const { data, error } = await supabase.storage
                                      .from("project-reports")
                                      .createSignedUrl(project.report_file_path, 60, {
                                        download: project.report_file_name || true,
                                      });
                                    if (error || !data?.signedUrl) {
                                      toast({
                                        variant: "destructive",
                                        title: "Download failed",
                                        description: getUserFriendlyError(error),
                                      });
                                      return;
                                    }
                                    window.open(data.signedUrl, "_blank");
                                  }}
                                >
                                  <Download className="h-4 w-4" />
                                </Button>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {project.report_file_path
                                ? `Download ${project.report_file_name || "report"}`
                                : "No report available"}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        {userProjectRoles.get(project.id) === "admin" && canDeleteProject && (
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

        {!loading && user && projects.length > 0 && (
          <div className="flex justify-center gap-3 mt-6">
            {hasMore && (
              <Button
                variant="outline"
                onClick={() => fetchProjects()}
                disabled={loadingMore}
              >
                {loadingMore ? "Loading…" : "Load More"}
              </Button>
            )}
            {canCreateProject && (
              <Button onClick={handleNewProject}>Add New Project</Button>
            )}
          </div>
        )}
      </main>



      <CreateProjectModal
        open={showCreateModal}
        onOpenChange={setShowCreateModal}
        onCreated={() => fetchProjects({ reset: true })}
      />
    </div>
  );
};

export default Projects;
