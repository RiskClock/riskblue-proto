import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Check, Link2 } from "lucide-react";
import { ProcoreFolderTree } from "@/components/wizard/ProcoreFolderTree";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useProcoreToken } from "@/hooks/useProcoreToken";
import { useAuth } from "@/contexts/AuthContext";
import procoreIcon from "@/assets/icon_procore.png";

interface ProcoreCompany {
  id: number;
  name: string;
}

interface ProcoreProject {
  id: number;
  name: string;
  address?: string;
  city?: string;
}

interface ProcoreFolder {
  id: number;
  name: string;
  folders?: ProcoreFolder[];
  files?: { id: number; name: string; }[];
}

interface ProcoreConnectionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  projectName?: string;
  onAnalysisStarted?: () => void;
}

export const ProcoreConnectionDialog = ({
  isOpen,
  onClose,
  projectId,
  projectName,
  onAnalysisStarted,
}: ProcoreConnectionDialogProps) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const {
    procoreToken,
    isConnected,
    connectProcore,
    disconnectProcore,
  } = useProcoreToken();

  const [connectingProcore, setConnectingProcore] = useState(false);
  const [companies, setCompanies] = useState<ProcoreCompany[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("");
  const [projects, setProjects] = useState<ProcoreProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [folders, setFolders] = useState<ProcoreFolder[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState(false);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState<"connect" | "select">("connect");

  // Load companies when connected
  useEffect(() => {
    if (isConnected && isOpen) {
      setStep("select");
      loadCompanies();
    } else {
      setStep("connect");
    }
  }, [isConnected, isOpen]);

  // Load projects when company selected
  useEffect(() => {
    if (selectedCompanyId) {
      loadProjects(selectedCompanyId);
    }
  }, [selectedCompanyId]);

  // Load folders when project selected
  useEffect(() => {
    if (selectedProjectId && selectedCompanyId) {
      loadFolders(selectedCompanyId, selectedProjectId);
    }
  }, [selectedProjectId, selectedCompanyId]);

  const callProcoreApi = async (action: string, params: Record<string, string> = {}) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Not authenticated");

    const queryStr = new URLSearchParams({ action, ...params }).toString();
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/list-procore-files?${queryStr}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: "Request failed" }));
      throw new Error(err.error || "Request failed");
    }
    return resp.json();
  };

  const loadCompanies = async () => {
    setLoadingCompanies(true);
    try {
      const data = await callProcoreApi("list-companies");
      setCompanies(data.companies || []);
      // Auto-select if only one company
      if (data.companies?.length === 1) {
        setSelectedCompanyId(String(data.companies[0].id));
      }
    } catch (err) {
      console.error("Error loading companies:", err);
      toast({ title: "Error", description: "Failed to load Procore companies.", variant: "destructive" });
    } finally {
      setLoadingCompanies(false);
    }
  };

  const loadProjects = async (companyId: string) => {
    setLoadingProjects(true);
    setProjects([]);
    setSelectedProjectId("");
    try {
      const data = await callProcoreApi("list-projects", { companyId });
      setProjects(data.projects || []);
    } catch (err) {
      console.error("Error loading projects:", err);
      toast({ title: "Error", description: "Failed to load Procore projects.", variant: "destructive" });
    } finally {
      setLoadingProjects(false);
    }
  };

  const loadFolders = async (companyId: string, procoreProjectId: string) => {
    setLoadingFolders(true);
    setFolders([]);
    try {
      const data = await callProcoreApi("list-folders", { companyId, projectId: procoreProjectId });
      // The API returns { folders: [...], files: [...] }
      setFolders(data.folders || []);
    } catch (err) {
      console.error("Error loading folders:", err);
      toast({ title: "Error", description: "Failed to load folders.", variant: "destructive" });
    } finally {
      setLoadingFolders(false);
    }
  };

  const handleConnect = async () => {
    setConnectingProcore(true);
    try {
      const projectPath = window.location.pathname;
      await connectProcore(projectPath);
      setConnectingProcore(false);
    } catch (error) {
      console.error("Procore connection error:", error);
      toast({
        title: "Connection Failed",
        description: error instanceof Error ? error.message : "Could not connect to Procore.",
        variant: "destructive",
      });
      setConnectingProcore(false);
    }
  };

  const handleSubmitAnalysis = async () => {
    if (!selectedProjectId || !selectedCompanyId || !user) return;
    setSubmitting(true);
    try {
      const selectedProject = projects.find(p => String(p.id) === selectedProjectId);
      
      // Create analysis request
      const { data: analysisRequest, error: insertError } = await supabase
        .from("analysis_requests")
        .insert({
          project_id: projectId,
          user_id: user.id,
          source_type: "procore",
          status: "pending",
          drive_folder_id: `procore:${selectedCompanyId}:${selectedProjectId}`,
        })
        .select()
        .single();

      if (insertError) throw new Error(insertError.message);

      // Trigger background file copy
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const copyUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/copy-procore-files`;
        await fetch(copyUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ analysisRequestId: analysisRequest.id }),
        });
      }

      // Log activity
      await supabase.from("user_activity_logs").insert({
        user_id: user.id,
        action: "procore_analysis_request",
        project_id: projectId,
        metadata: {
          procore_company_id: selectedCompanyId,
          procore_project_id: selectedProjectId,
          procore_project_name: selectedProject?.name,
          analysis_request_id: analysisRequest.id,
        },
      });

      toast({
        title: "Analysis Queued",
        description: `Procore project "${selectedProject?.name}" submitted for analysis. Files are being copied.`,
      });

      onAnalysisStarted?.();
      onClose();
    } catch (err) {
      console.error("Error submitting analysis:", err);
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to submit analysis",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDisconnect = async () => {
    await disconnectProcore();
    setCompanies([]);
    setProjects([]);
    setFolders([]);
    setSelectedCompanyId("");
    setSelectedProjectId("");
    setStep("connect");
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <img src={procoreIcon} alt="Procore" className="w-5 h-5" />
            Connect Procore
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {step === "connect" && !isConnected ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Connect your Procore account to analyze drawing files and automatically detect Assets and Water Systems.
              </p>
              <Button onClick={handleConnect} disabled={connectingProcore} className="w-full">
                {connectingProcore ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  <>
                    <img src={procoreIcon} alt="" className="w-4 h-4 mr-2" />
                    Connect Procore
                  </>
                )}
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                A new window will open for authentication
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-green-600">
                <Check className="w-4 h-4" />
                Connected{procoreToken?.procoreEmail ? ` as ${procoreToken.procoreEmail}` : ""}
              </div>

              {/* Company selector */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Company</label>
                {loadingCompanies ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading companies...
                  </div>
                ) : (
                  <Select value={selectedCompanyId} onValueChange={setSelectedCompanyId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a company..." />
                    </SelectTrigger>
                    <SelectContent>
                      {companies.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {/* Project selector */}
              {selectedCompanyId && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Procore Project</label>
                  {loadingProjects ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Loading projects...
                    </div>
                  ) : (
                    <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a project..." />
                      </SelectTrigger>
                      <SelectContent>
                        {projects.map((p) => (
                          <SelectItem key={p.id} value={String(p.id)}>
                            <div className="flex flex-col items-start">
                              <span>{p.name}</span>
                              {(p.city || p.address) && (
                                <span className="text-xs text-muted-foreground">
                                  {[p.address, p.city].filter(Boolean).join(", ")}
                                </span>
                              )}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}

              {/* Folder preview */}
              {selectedProjectId && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Document Folders</label>
                  {loadingFolders ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Loading folders...
                    </div>
                  ) : folders.length > 0 ? (
                    <div className="border rounded-md p-2 max-h-60 overflow-y-auto">
                      <ProcoreFolderTree
                        folders={folders}
                        loadSubfolder={async (folderId) => {
                          const data = await callProcoreApi("list-subfolder", {
                            companyId: selectedCompanyId,
                            projectId: selectedProjectId,
                            folderId,
                          });
                          return data;
                        }}
                      />
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No folders found in this project.</p>
                  )}
                </div>
              )}

              {/* Submit */}
              <Button
                onClick={handleSubmitAnalysis}
                disabled={submitting || !selectedProjectId}
                className="w-full"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  <>
                    <Link2 className="w-4 h-4 mr-2" />
                    Analyze
                  </>
                )}
              </Button>

              <Button
                variant="ghost"
                size="sm"
                onClick={handleDisconnect}
                className="w-full text-muted-foreground"
              >
                Disconnect
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
