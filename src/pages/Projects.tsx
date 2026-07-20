import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";
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
  credits_consumed?: number | null;
  report_file_path?: string | null;
  report_file_name?: string | null;
  workbench_status?: string | null;
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
  return parts.length > 0 ? parts.join(", ") : "-";
};

const analysisStatusLabels: Record<string, string> = {
  awaiting_upload: "Awaiting Upload",
  pending: "Importing Drawings",
  copying: "Importing Drawings",
  copied: "Ready for Analysis",
  started: "Analysis Started",
  processing: "Analysis in Progress",
  complete: "Analysis Complete",
  failed: "Import Failed",
};

const analysisStatusColors: Record<string, string> = {
  awaiting_upload: "bg-gray-100 text-gray-800 border-gray-300",
  pending: "bg-blue-100 text-blue-800 border-blue-300",
  copying: "bg-blue-100 text-blue-800 border-blue-300",
  copied: "bg-amber-100 text-amber-800 border-amber-300",
  started: "bg-yellow-100 text-yellow-800 border-yellow-300",
  processing: "bg-purple-100 text-purple-800 border-purple-300",
  complete: "bg-emerald-100 text-emerald-800 border-emerald-300",
  failed: "bg-red-100 text-red-800 border-red-300",
};

const Projects = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { isWMSV } = useAccountType();
  useHeapIdentify();
  const { logActivity } = useActivityLogger();
  const [projects, setProjects] = useState<ProjectWithCreator[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [userProjectRoles, setUserProjectRoles] = useState<Map<string, string>>(new Map());
  const [analysisStatuses, setAnalysisStatuses] = useState<Map<string, string>>(new Map());
  const [showWelcome, setShowWelcome] = useState(() => 
    sessionStorage.getItem('riskblue_welcome_dismissed') !== 'true'
  );

  const projectIdsRef = useRef<string[]>([]);
  const fetchSeqRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep projectIdsRef in sync with projects
  useEffect(() => {
    projectIdsRef.current = projects.map(p => p.id);
  }, [projects]);

  const fetchAnalysisStatuses = useCallback(async (ids: string[]) => {
    if (!ids.length) return;
    const seq = ++fetchSeqRef.current;
    const { data } = await supabase
      .from("analysis_requests")
      .select("project_id, status")
      .in("project_id", ids)
      .order("created_at", { ascending: false });
    if (seq !== fetchSeqRef.current) return; // superseded by a newer call
    const statusMap = new Map<string, string>();
    if (data) {
      for (const row of data as Array<{ project_id: string; status: string }>) {
        if (!statusMap.has(row.project_id)) {
          statusMap.set(row.project_id, row.status);
        }
      }
    }
    setAnalysisStatuses(statusMap);
  }, []);

  const debouncedFetchStatuses = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      fetchAnalysisStatuses(projectIdsRef.current);
    }, 500);
  }, [fetchAnalysisStatuses]);

  const handleDismissWelcome = () => {
    setShowWelcome(false);
    sessionStorage.setItem('riskblue_welcome_dismissed', 'true');
  };

  const projectIds = useMemo(() => projects.map(p => p.id), [projects]);

  useEffect(() => {
    if (user) {
      fetchProjects();
    }
  }, [user]);


  const fetchProjects = async () => {
    try {
      const isInternalUser = user?.email?.toLowerCase().endsWith("@riskclock.com") ?? false;
      // Internal users see projects they created OR are a member of (Workbench shows all)
      let query = supabase
        .from("projects")
        .select("*")
        .order("created_at", { ascending: false });
      if (isInternalUser) {
        // Fetch project ids the internal user is a member of (collaborator/admin)
        const { data: memberRoles } = await supabase
          .from("project_user_roles")
          .select("project_id")
          .eq("user_id", user!.id);
        const memberProjectIds = (memberRoles || []).map(r => r.project_id);
        if (memberProjectIds.length > 0) {
          query = query.or(`user_id.eq.${user!.id},id.in.(${memberProjectIds.join(",")})`);
        } else {
          query = query.eq("user_id", user!.id);
        }
      }
      const { data: projectsData, error: projectsError } = await query;

      if (projectsError) throw projectsError;


      // Get unique user IDs and project IDs
      const userIds = [...new Set((projectsData || []).map(p => p.user_id))];
      const projectIds = (projectsData || []).map(p => p.id);
      
      // Fetch profiles, roles, emails, and analysis statuses in parallel
      const [profilesResult, rolesResult, emailsResult, analysisResult] = await Promise.all([
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
        ).catch(() => ({ data: null })),
        Promise.resolve({ data: null }),
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

      // Build analysis status map (latest per project) - reuse extracted helper
      if (analysisResult.data) {
        const seq = ++fetchSeqRef.current;
        const statusMap = new Map<string, string>();
        for (const row of analysisResult.data as Array<{ project_id: string; status: string }>) {
          if (!statusMap.has(row.project_id)) {
            statusMap.set(row.project_id, row.status);
          }
        }
        if (seq === fetchSeqRef.current) {
          setAnalysisStatuses(statusMap);
        }
      }

      // Merge projects with creator names and emails
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
            <Button onClick={handleNewProject}>Create your first project</Button>
          </div>
        ) : (
          <div className="bg-card rounded-lg border overflow-hidden">
            <table className="w-full">
              <thead className="bg-muted/50">
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
                        isWMSV
                          ? `/workbench/project/${project.id}`
                          : `/project/${project.id}`,
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


      <CreateProjectModal
        open={showCreateModal}
        onOpenChange={setShowCreateModal}
        onCreated={fetchProjects}
      />
    </div>
  );
};

export default Projects;
