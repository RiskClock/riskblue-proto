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
  analysisRequestId?: string;
}

export const ProcoreConnectionDialog = ({
  isOpen,
  onClose,
  projectId,
  projectName,
  onAnalysisStarted,
  analysisRequestId,
}: ProcoreConnectionDialogProps) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const {
    procoreToken,
    isConnected,
    connectProcore,
    disconnectProcore,
  } = useProcoreToken();

  const LS_COMPANY_KEY = "procore_last_company_id";
  const LS_PROJECT_KEY = "procore_last_project_id";

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

  // Folder selection state
  const [selectedFolderId, setSelectedFolderId] = useState<string>("");
  const [selectedFolderName, setSelectedFolderName] = useState<string>("");

  // Load companies when connected
  useEffect(() => {
    if (isConnected && isOpen) {
      setStep("select");
      loadCompanies();
    } else if (!isConnected) {
      setStep("connect");
    }
  }, [isConnected, isOpen]);

  // Reset folder selection when project changes
  useEffect(() => {
    setSelectedFolderId("");
    setSelectedFolderName("");
  }, [selectedProjectId]);

  // Load projects when company selected
  useEffect(() => {
    if (selectedCompanyId) {
      localStorage.setItem(LS_COMPANY_KEY, selectedCompanyId);
      loadProjects(selectedCompanyId);
    }
  }, [selectedCompanyId]);

  // Load folders when project selected
  useEffect(() => {
    if (selectedProjectId) {
      localStorage.setItem(LS_PROJECT_KEY, selectedProjectId);
    }
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
      const loadedCompanies = data.companies || [];
      setCompanies(loadedCompanies);

      const savedCompanyId = localStorage.getItem(LS_COMPANY_KEY);
      if (savedCompanyId && loadedCompanies.some((c: ProcoreCompany) => String(c.id) === savedCompanyId)) {
        setSelectedCompanyId(savedCompanyId);
      } else if (loadedCompanies.length === 1) {
        setSelectedCompanyId(String(loadedCompanies[0].id));
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
      const loadedProjects = data.projects || [];
      setProjects(loadedProjects);

      const savedProjectId = localStorage.getItem(LS_PROJECT_KEY);
      if (savedProjectId && loadedProjects.some((p: ProcoreProject) => String(p.id) === savedProjectId)) {
        setSelectedProjectId(savedProjectId);
      }
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

  const handleSelectFolder = (folderId: string, folderName: string) => {
    if (selectedFolderId === folderId) {
      // Deselect
      setSelectedFolderId("");
      setSelectedFolderName("");
    } else {
      setSelectedFolderId(folderId);
      setSelectedFolderName(folderName);
    }
  };

  const handleSubmitAnalysis = async () => {
    if (!selectedProjectId || !selectedCompanyId || !user) return;
    setSubmitting(true);
    try {
      const selectedProject = projects.find(p => String(p.id) === selectedProjectId);
      
      // Build drive_folder_id with optional folder scoping
      const driveFolderId = selectedFolderId
        ? `procore:${selectedCompanyId}:${selectedProjectId}:${selectedFolderId}`
        : `procore:${selectedCompanyId}:${selectedProjectId}`;

      let requestId: string;

      if (analysisRequestId) {
        // Update existing analysis request
        const { error: updateError } = await supabase
          .from("analysis_requests")
          .update({
            source_type: "procore",
            status: "pending",
            drive_folder_id: driveFolderId,
            error_message: null,
          })
          .eq("id", analysisRequestId);
        if (updateError) throw new Error(updateError.message);
        requestId = analysisRequestId;
      } else {
        // Create new analysis request
        const { data: analysisRequest, error: insertError } = await supabase
          .from("analysis_requests")
          .insert({
            project_id: projectId,
            user_id: user.id,
            source_type: "procore",
            status: "pending",
            drive_folder_id: driveFolderId,
          })
          .select()
          .single();
        if (insertError) throw new Error(insertError.message);
        requestId = analysisRequest.id;
      }

      // Trigger file copy
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const copyUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/copy-procore-files`;
        fetch(copyUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ analysisRequestId: requestId }),
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
          procore_folder_id: selectedFolderId || null,
          procore_folder_name: selectedFolderName || null,
          analysis_request_id: requestId,
        },
      });

      const folderLabel = selectedFolderName
        ? `folder "${selectedFolderName}"`
        : `project "${selectedProject?.name}"`;

      toast({
        title: "Analysis Queued",
        description: `Procore ${folderLabel} submitted for analysis. Files are being copied.`,
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
    setSelectedFolderId("");
    setSelectedFolderName("");
    setStep("connect");
  };

  const analyzeLabel = selectedFolderName
    ? `Analyze "${selectedFolderName}"`
    : "Analyze";

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl w-[min(92vw,42rem)]">
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

              {/* Folder browser with selection */}
              {selectedProjectId && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    Select a Folder
                    <span className="text-muted-foreground font-normal ml-1">(optional — defaults to entire project)</span>
                  </label>
                  {loadingFolders ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Loading folders...
                    </div>
                  ) : folders.length > 0 ? (
                    <div className="border rounded-md p-2 max-h-60 overflow-auto">
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
                        selectable
                        selectedFolderId={selectedFolderId}
                        onSelectFolder={(folderId) => {
                          // Find folder name from the tree
                          const findName = (folders: ProcoreFolder[]): string => {
                            for (const f of folders) {
                              if (String(f.id) === folderId) return f.name;
                              if (f.folders) {
                                const found = findName(f.folders);
                                if (found) return found;
                              }
                            }
                            return "";
                          };
                          const name = findName(folders);
                          handleSelectFolder(folderId, name);
                        }}
                        hideFiles={false}
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
                    {analyzeLabel}
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
