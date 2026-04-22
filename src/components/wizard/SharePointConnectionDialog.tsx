import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Check, Link2 } from "lucide-react";
import { SharePointFolderTree } from "@/components/wizard/SharePointFolderTree";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useSharePointToken } from "@/hooks/useSharePointToken";
import { useAuth } from "@/contexts/AuthContext";
import sharepointIcon from "@/assets/icon_sharepoint.png";

interface SPSite { id: string; name: string; webUrl?: string; }
interface SPDrive { id: string; name: string; driveType?: string; }
interface SPFolder { id: string; name: string; }
interface SPFile { id: string; name: string; }

interface SharePointConnectionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  projectName?: string;
  onAnalysisStarted?: () => void;
  analysisRequestId?: string;
}

export const SharePointConnectionDialog = ({
  isOpen, onClose, projectId, projectName, onAnalysisStarted, analysisRequestId,
}: SharePointConnectionDialogProps) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const { sharepointToken, isConnected, connectSharePoint, disconnectSharePoint } = useSharePointToken();

  const LS_SITE = "sharepoint_last_site_id";
  const LS_DRIVE = "sharepoint_last_drive_id";

  const [connecting, setConnecting] = useState(false);
  const [sites, setSites] = useState<SPSite[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState("");
  const [drives, setDrives] = useState<SPDrive[]>([]);
  const [selectedDriveId, setSelectedDriveId] = useState("");
  const [folders, setFolders] = useState<SPFolder[]>([]);
  const [files, setFiles] = useState<SPFile[]>([]);
  const [loadingSites, setLoadingSites] = useState(false);
  const [loadingDrives, setLoadingDrives] = useState(false);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState<"connect" | "select">("connect");

  const [selectedFolderId, setSelectedFolderId] = useState("");
  const [selectedFolderName, setSelectedFolderName] = useState("");

  useEffect(() => {
    if (isConnected && isOpen) { setStep("select"); loadSites(); }
    else if (!isConnected) { setStep("connect"); }
  }, [isConnected, isOpen]);

  useEffect(() => {
    setSelectedFolderId("");
    setSelectedFolderName("");
  }, [selectedDriveId, selectedSiteId]);

  useEffect(() => {
    if (selectedSiteId) {
      localStorage.setItem(LS_SITE, selectedSiteId);
      loadDrives(selectedSiteId);
    }
  }, [selectedSiteId]);

  useEffect(() => {
    if (selectedDriveId) localStorage.setItem(LS_DRIVE, selectedDriveId);
    if (selectedSiteId && selectedDriveId) loadFolders(selectedSiteId, selectedDriveId);
  }, [selectedDriveId, selectedSiteId]);

  const callApi = async (action: string, params: Record<string, string> = {}) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Not authenticated");
    const queryStr = new URLSearchParams({ action, ...params }).toString();
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/list-sharepoint-files?${queryStr}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: "Request failed" }));
      throw new Error(err.error || "Request failed");
    }
    return resp.json();
  };

  const loadSites = async () => {
    setLoadingSites(true);
    try {
      const data = await callApi("list-sites");
      const loaded = data.sites || [];
      setSites(loaded);
      const saved = localStorage.getItem(LS_SITE);
      if (saved && loaded.some((s: SPSite) => s.id === saved)) setSelectedSiteId(saved);
      else if (loaded.length === 1) setSelectedSiteId(loaded[0].id);
    } catch (err) {
      toast({ title: "Error", description: "Failed to load SharePoint sites.", variant: "destructive" });
    } finally { setLoadingSites(false); }
  };

  const loadDrives = async (siteId: string) => {
    setLoadingDrives(true);
    setDrives([]); setSelectedDriveId("");
    try {
      const data = await callApi("list-drives", { siteId });
      const loaded = data.drives || [];
      setDrives(loaded);
      const saved = localStorage.getItem(LS_DRIVE);
      if (saved && loaded.some((d: SPDrive) => d.id === saved)) setSelectedDriveId(saved);
      else if (loaded.length === 1) setSelectedDriveId(loaded[0].id);
    } catch (err) {
      toast({ title: "Error", description: "Failed to load document libraries.", variant: "destructive" });
    } finally { setLoadingDrives(false); }
  };

  const loadFolders = async (siteId: string, driveId: string) => {
    setLoadingFolders(true);
    setFolders([]); setFiles([]);
    try {
      const data = await callApi("list-folders", { siteId, driveId });
      setFolders(data.folders || []);
      setFiles(data.files || []);
    } catch (err) {
      toast({ title: "Error", description: "Failed to load folders.", variant: "destructive" });
    } finally { setLoadingFolders(false); }
  };

  const handleConnect = async () => {
    setConnecting(true);
    try {
      await connectSharePoint(window.location.pathname);
    } catch (error) {
      toast({
        title: "Connection Failed",
        description: error instanceof Error ? error.message : "Could not connect to SharePoint.",
        variant: "destructive",
      });
    } finally { setConnecting(false); }
  };

  const handleSelectFolder = (folderId: string, folderName: string) => {
    if (selectedFolderId === folderId) {
      setSelectedFolderId(""); setSelectedFolderName("");
    } else {
      setSelectedFolderId(folderId); setSelectedFolderName(folderName);
    }
  };

  const handleSubmitAnalysis = async () => {
    if (!selectedSiteId || !selectedDriveId || !user) return;
    setSubmitting(true);
    try {
      const driveFolderId = selectedFolderId
        ? `sharepoint:${selectedSiteId}:${selectedDriveId}:${selectedFolderId}`
        : `sharepoint:${selectedSiteId}:${selectedDriveId}`;

      let requestId: string;
      if (analysisRequestId) {
        const { error: updateError } = await supabase.from("analysis_requests").update({
          source_type: "sharepoint", status: "pending",
          drive_folder_id: driveFolderId, error_message: null,
        }).eq("id", analysisRequestId);
        if (updateError) throw new Error(updateError.message);
        requestId = analysisRequestId;
      } else {
        const { data: analysisRequest, error: insertError } = await supabase
          .from("analysis_requests").insert({
            project_id: projectId, user_id: user.id,
            source_type: "sharepoint", status: "pending",
            drive_folder_id: driveFolderId,
          }).select().single();
        if (insertError) throw new Error(insertError.message);
        requestId = analysisRequest.id;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const copyUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/copy-sharepoint-files`;
        fetch(copyUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ analysisRequestId: requestId }),
        });
      }

      const selectedSite = sites.find(s => s.id === selectedSiteId);
      await supabase.from("user_activity_logs").insert({
        user_id: user.id, action: "sharepoint_analysis_request", project_id: projectId,
        metadata: {
          sharepoint_site_id: selectedSiteId, sharepoint_site_name: selectedSite?.name,
          sharepoint_drive_id: selectedDriveId,
          sharepoint_folder_id: selectedFolderId || null,
          sharepoint_folder_name: selectedFolderName || null,
          analysis_request_id: requestId,
        },
      });

      const folderLabel = selectedFolderName
        ? `folder "${selectedFolderName}"`
        : `library "${drives.find(d => d.id === selectedDriveId)?.name}"`;

      toast({
        title: "Analysis Queued",
        description: `SharePoint ${folderLabel} submitted for analysis. Files are being copied.`,
      });
      onAnalysisStarted?.();
      onClose();
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to submit analysis",
        variant: "destructive",
      });
    } finally { setSubmitting(false); }
  };

  const handleDisconnect = async () => {
    await disconnectSharePoint();
    setSites([]); setDrives([]); setFolders([]); setFiles([]);
    setSelectedSiteId(""); setSelectedDriveId("");
    setSelectedFolderId(""); setSelectedFolderName("");
    setStep("connect");
  };

  const analyzeLabel = selectedFolderName ? `Analyze "${selectedFolderName}"` : "Analyze";

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl w-[min(92vw,42rem)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <img src={sharepointIcon} alt="SharePoint" className="w-5 h-5" />
            Connect SharePoint
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {step === "connect" && !isConnected ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Connect your SharePoint account to analyze drawing files and automatically detect Assets and Water Systems.
              </p>
              <Button onClick={handleConnect} disabled={connecting} className="w-full">
                {connecting ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Connecting...</>
                ) : (
                  <><img src={sharepointIcon} alt="" className="w-4 h-4 mr-2" />Connect SharePoint</>
                )}
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                A new window will open for Microsoft authentication
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-green-600">
                <Check className="w-4 h-4" />
                Connected{sharepointToken?.sharepointEmail ? ` as ${sharepointToken.sharepointEmail}` : ""}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Site</label>
                {loadingSites ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />Loading sites...
                  </div>
                ) : (
                  <Select value={selectedSiteId} onValueChange={setSelectedSiteId}>
                    <SelectTrigger><SelectValue placeholder="Select a site..." /></SelectTrigger>
                    <SelectContent>
                      {sites.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {selectedSiteId && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Document Library</label>
                  {loadingDrives ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin" />Loading libraries...
                    </div>
                  ) : (
                    <Select value={selectedDriveId} onValueChange={setSelectedDriveId}>
                      <SelectTrigger><SelectValue placeholder="Select a library..." /></SelectTrigger>
                      <SelectContent>
                        {drives.map((d) => (
                          <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}

              {selectedDriveId && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    Select a Folder
                    <span className="text-muted-foreground font-normal ml-1">(optional — defaults to entire library)</span>
                  </label>
                  {loadingFolders ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin" />Loading folders...
                    </div>
                  ) : (folders.length > 0 || files.length > 0) ? (
                    <div className="border rounded-md p-2 max-h-60 overflow-auto">
                      <SharePointFolderTree
                        folders={folders}
                        files={files}
                        loadChildren={async (folderId) => {
                          const data = await callApi("list-subfolder", {
                            siteId: selectedSiteId, driveId: selectedDriveId, folderId,
                          });
                          return { folders: data.folders || [], files: data.files || [] };
                        }}
                        selectable
                        selectedFolderId={selectedFolderId}
                        onSelectFolder={handleSelectFolder}
                        hideFiles={false}
                      />
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No folders found in this library.</p>
                  )}
                </div>
              )}

              <Button
                onClick={handleSubmitAnalysis}
                disabled={submitting || !selectedDriveId}
                className="w-full"
              >
                {submitting ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Submitting...</>
                ) : (
                  <><Link2 className="w-4 h-4 mr-2" />{analyzeLabel}</>
                )}
              </Button>

              <Button variant="ghost" size="sm" onClick={handleDisconnect}
                className="w-full text-muted-foreground">
                Disconnect
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
