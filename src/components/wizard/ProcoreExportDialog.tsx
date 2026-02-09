import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Check, Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ProcoreFolderTree } from "@/components/wizard/ProcoreFolderTree";
import { supabase } from "@/integrations/supabase/client";
import { useProcoreToken } from "@/hooks/useProcoreToken";
import procoreIcon from "@/assets/icon_procore.png";

interface ProcoreCompany {
  id: number;
  name: string;
}

interface ProcoreProject {
  id: number;
  name: string;
}

interface ProcoreFolder {
  id: number;
  name: string;
}

interface ProcoreExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  pdfBlob: Blob | null;
  fileName: string;
}

export const ProcoreExportDialog = ({
  isOpen,
  onClose,
  pdfBlob,
  fileName,
}: ProcoreExportDialogProps) => {
  const { toast } = useToast();
  const {
    procoreToken,
    isConnected,
    connectProcore,
  } = useProcoreToken();

  const [connectingProcore, setConnectingProcore] = useState(false);
  const [companies, setCompanies] = useState<ProcoreCompany[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("");
  const [projects, setProjects] = useState<ProcoreProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [folders, setFolders] = useState<ProcoreFolder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string>("");
  const [loadingCompanies, setLoadingCompanies] = useState(false);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (isConnected && isOpen) {
      loadCompanies();
    }
  }, [isConnected, isOpen]);

  useEffect(() => {
    if (selectedCompanyId) loadProjects(selectedCompanyId);
  }, [selectedCompanyId]);

  useEffect(() => {
    if (selectedProjectId && selectedCompanyId) loadFolders(selectedCompanyId, selectedProjectId);
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
    setFolders([]);
    setSelectedFolderId("");
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
    setSelectedFolderId("");
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
      await connectProcore(window.location.pathname);
    } catch (error) {
      toast({
        title: "Connection Failed",
        description: error instanceof Error ? error.message : "Could not connect to Procore.",
        variant: "destructive",
      });
    } finally {
      setConnectingProcore(false);
    }
  };

  const handleUpload = async () => {
    if (!pdfBlob || !selectedProjectId || !selectedCompanyId) return;
    setUploading(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const formData = new FormData();
      formData.append("companyId", selectedCompanyId);
      formData.append("projectId", selectedProjectId);
      if (selectedFolderId) formData.append("folderId", selectedFolderId);
      formData.append("fileName", fileName);
      formData.append("file", pdfBlob, fileName);

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-to-procore`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        body: formData,
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Upload failed" }));
        throw new Error(err.error || "Upload failed");
      }

      toast({
        title: "Exported to Procore",
        description: `"${fileName}" has been uploaded to Procore Documents.`,
      });
      onClose();
    } catch (err) {
      console.error("Procore upload error:", err);
      toast({
        title: "Export Failed",
        description: err instanceof Error ? err.message : "Failed to upload to Procore.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <img src={procoreIcon} alt="Procore" className="w-5 h-5" />
            Export to Procore
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {!isConnected ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Connect your Procore account to export the PDF report directly to Procore Documents.
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
              <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
                <Check className="w-4 h-4" />
                Connected{procoreToken?.procoreEmail ? ` as ${procoreToken.procoreEmail}` : ""}
              </div>

              <div className="bg-muted/30 p-3 rounded-md text-sm">
                <p className="font-medium mb-1">File to export:</p>
                <p className="text-muted-foreground truncate">{fileName}</p>
              </div>

              {/* Company selector */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Company</label>
                {loadingCompanies ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading companies...
                  </div>
                ) : (
                  <Select value={selectedCompanyId} onValueChange={setSelectedCompanyId}>
                    <SelectTrigger><SelectValue placeholder="Select a company..." /></SelectTrigger>
                    <SelectContent>
                      {companies.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
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
                      <Loader2 className="w-4 h-4 animate-spin" /> Loading projects...
                    </div>
                  ) : (
                    <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                      <SelectTrigger><SelectValue placeholder="Select a project..." /></SelectTrigger>
                      <SelectContent>
                        {projects.map((p) => (
                          <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}

              {/* Folder selector (optional) */}
              {selectedProjectId && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Destination Folder <span className="text-muted-foreground font-normal">(optional)</span></label>
                  {loadingFolders ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin" /> Loading folders...
                    </div>
                  ) : folders.length > 0 ? (
                    <div className="border rounded-md p-2 max-h-48 overflow-y-auto">
                      <div
                        className={`flex items-center gap-1.5 py-1 px-2 rounded cursor-pointer text-sm hover:bg-muted/50 transition-colors mb-0.5 ${
                          !selectedFolderId || selectedFolderId === "__root__"
                            ? "bg-primary/10 ring-1 ring-primary/30"
                            : ""
                        }`}
                        onClick={() => setSelectedFolderId("__root__")}
                      >
                        <span className="flex-1">📁 Root folder</span>
                        {(!selectedFolderId || selectedFolderId === "__root__") && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-primary text-primary-foreground">Selected</span>
                        )}
                      </div>
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
                        onSelectFolder={(id) => setSelectedFolderId(id)}
                      />
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No folders found — file will be uploaded to root.</p>
                  )}
                </div>
              )}

              {/* Upload button */}
              <Button
                onClick={handleUpload}
                disabled={uploading || !selectedProjectId || !pdfBlob}
                className="w-full"
              >
                {uploading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    Export to Procore
                  </>
                )}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
