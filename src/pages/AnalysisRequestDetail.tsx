import { useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { AppHeader } from "@/components/AppHeader";
import { AnalysisSection } from "@/components/analysis/AnalysisSection";
import { AnalysisDebugPanel } from "@/components/analysis/AnalysisDebugPanel";
import { useAnalysisRequestState } from "@/hooks/useAnalysisRequestState";
import { uiStateBadgeClass } from "@/lib/analysisUiState";
import { useHeapIdentify } from "@/hooks/useHeapIdentify";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Loader2, ShieldAlert, Upload, FileText, CheckCircle2, Circle, Download } from "lucide-react";
import { format } from "date-fns";
import { ActiveExportModal } from "@/components/export/ActiveExportModal";
import { useAnalysisExport } from "@/hooks/useAnalysisExport";
import { RepositoryConnectionDialog } from "@/components/wizard/RepositoryConnectionDialog";
import { ProcoreConnectionDialog } from "@/components/wizard/ProcoreConnectionDialog";
import { SharePointConnectionDialog } from "@/components/wizard/SharePointConnectionDialog";

interface AnalysisFile {
  id: string;
  name: string;
  mime_type: string;
  size_bytes: number | null;
  relative_path: string;
  storage_path: string | null;
  copy_status: string;
}

const statusColors: Record<string, string> = {
  awaiting_upload: "bg-gray-100 text-gray-800 border-gray-300",
  pending: "bg-blue-100 text-blue-800 border-blue-300",
  copying: "bg-blue-100 text-blue-800 border-blue-300",
  copied: "bg-amber-100 text-amber-800 border-amber-300",
  started: "bg-yellow-100 text-yellow-800 border-yellow-300",
  processing: "bg-purple-100 text-purple-800 border-purple-300",
  complete: "bg-emerald-100 text-emerald-800 border-emerald-300",
  failed: "bg-red-100 text-red-800 border-red-300",
};

const statusLabels: Record<string, string> = {
  awaiting_upload: "Awaiting File Upload",
  pending: "Importing Files",
  copying: "Importing Files",
  copied: "Ready for Analysis",
  started: "Analysis Started",
  processing: "Analysis in Progress",
  complete: "Analysis Complete",
  failed: "Failed",
};

export default function AnalysisRequestDetail() {
  const { requestId } = useParams<{ requestId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  useHeapIdentify();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  // Cloud source dialog state
  const [showDriveDialog, setShowDriveDialog] = useState(false);
  const [showProcoreDialog, setShowProcoreDialog] = useState(false);
  const [showSharePointDialog, setShowSharePointDialog] = useState(false);

  const isInternal = user?.email?.toLowerCase().endsWith("@riskclock.com") ?? false;
  const requestState = useAnalysisRequestState(requestId);

  const isImporting = (s?: string) => s === "pending" || s === "copying";

  const { data: request, isLoading: requestLoading } = useQuery({
    queryKey: ["analysis-request", requestId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("analysis_requests")
        .select("*, project:projects(name)")
        .eq("id", requestId!)
        .single();
      if (error) throw error;

      try {
        const { data: emailsResult } = await supabase.functions.invoke(`get-user-emails?userIds=${data.user_id}`, { method: "GET" });
        if (emailsResult?.emails) {
          return { ...data, user_email: emailsResult.emails[data.user_id] || "Unknown" };
        }
      } catch {}
      return { ...data, user_email: "Unknown" };
    },
    enabled: isInternal && !!requestId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return isImporting(status) ? 3000 : false;
    },
  });

  const { data: files } = useQuery({
    queryKey: ["analysis-files", requestId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("analysis_request_files")
        .select("*")
        .eq("analysis_request_id", requestId!)
        .order("relative_path");
      if (error) throw error;
      return data as AnalysisFile[];
    },
    enabled: isInternal && !!requestId,
    refetchInterval: isImporting(request?.status) ? 3000 : false,
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles?.length || !request || !requestId) return;
    e.target.value = "";
    setUploading(true);

    try {
      let totalBytes = 0;
      for (const file of Array.from(selectedFiles)) {
        const filePath = `${request.project_id}/${requestId}/${file.name}`;
        const { error: uploadError } = await supabase.storage
          .from("uploaded-drawings")
          .upload(filePath, file);
        if (uploadError) throw uploadError;
        totalBytes += file.size;

        await supabase.from("analysis_request_files").insert({
          analysis_request_id: requestId,
          drive_file_id: `manual_${Date.now()}_${file.name}`,
          name: file.name,
          mime_type: file.type || "application/octet-stream",
          size_bytes: file.size,
          relative_path: file.name,
          storage_path: filePath,
          copy_status: "copied",
        });
      }

      await supabase
        .from("analysis_requests")
        .update({
          status: "copied",
          file_count: (request.file_count || 0) + selectedFiles.length,
          total_size_bytes: (request.total_size_bytes || 0) + totalBytes,
        })
        .eq("id", requestId);

      toast({ title: "Files Uploaded", description: `${selectedFiles.length} file(s) uploaded successfully.` });
      queryClient.invalidateQueries({ queryKey: ["analysis-request", requestId] });
      queryClient.invalidateQueries({ queryKey: ["analysis-files", requestId] });
    } catch (error) {
      toast({
        title: "Upload Failed",
        description: error instanceof Error ? error.message : "Failed to upload files",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleCloudAnalysisStarted = () => {
    queryClient.invalidateQueries({ queryKey: ["analysis-request", requestId] });
    queryClient.invalidateQueries({ queryKey: ["analysis-files", requestId] });
  };

  const {
    requestExport,
    confirmOpen,
    setConfirmOpen,
    confirmCancelAndRestart,
  } = useAnalysisExport(requestId);

  const handleExportClick = () => {
    if (!request) return;
    requestExport({
      projectId: request.project_id,
      projectName: request.project?.name || "Project",
      sourceType: request.source_type,
      summaryData: (request.summary_data ?? {}) as Record<string, unknown[]>,
    });
  };

  if (!isInternal) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <ShieldAlert className="h-16 w-16 text-destructive mx-auto" />
          <h1 className="text-2xl font-bold text-foreground">403 - Access Denied</h1>
          <p className="text-muted-foreground">You don't have permission to access this page.</p>
          <Button onClick={() => navigate("/projects")}>Go to Projects</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />

      <main className="container mx-auto px-6 py-8 max-w-[1400px]">
        <Button variant="ghost" size="sm" className="mb-4" onClick={() => navigate("/internal/analysis-queue")}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Analysis Queue
        </Button>

        {requestLoading ? (
          <div className="text-center py-12 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
            Loading...
          </div>
        ) : !request ? (
          <div className="text-center py-12 text-muted-foreground">Analysis request not found.</div>
        ) : (
          <div className="space-y-6">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-2xl font-bold text-foreground">{request.project?.name || "Unknown Project"}</h1>
                <p className="text-muted-foreground text-sm mt-1">
                  Submitted by {request.user_email} on {format(new Date(request.created_at), "MMM d, yyyy 'at' HH:mm")}
                </p>
              </div>
              <Badge variant="outline" className={uiStateBadgeClass(requestState.uiState)}>
                {requestState.label}
              </Badge>
            </div>

            {/* DEBUG PANEL — temporary instrumentation */}
            <AnalysisDebugPanel requestId={requestId!} requestState={requestState} rawRequest={request} />

            {request.error_message && (
              <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
                <p className="text-sm font-medium text-destructive">Error</p>
                <p className="text-sm text-destructive/80 mt-1">{request.error_message}</p>
              </div>
            )}

            {/* Awaiting File Upload UI */}
            {request.status === "awaiting_upload" && (!files || files.length === 0) && (
              <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-8 text-center space-y-4">
                <FileText className="w-12 h-12 text-muted-foreground/50 mx-auto" />
                <div>
                  <h3 className="text-lg font-medium text-foreground">No files uploaded yet</h3>
                  <p className="text-sm text-muted-foreground mt-1">Upload drawing files to begin analysis</p>
                </div>
                <div className="flex flex-wrap justify-center items-center gap-3">
                  <Button onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                    {uploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                    Upload from Computer
                  </Button>
                  <span className="text-sm text-muted-foreground">or</span>
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button variant="outline" onClick={() => setShowDriveDialog(true)}>
                      <img src="/icons/icon_googledrive.png" className="w-4 h-4 mr-2" alt="Google Drive" />
                      Google Drive
                    </Button>
                    <Button variant="outline" onClick={() => setShowProcoreDialog(true)}>
                      <img src="/icons/icon_procore.png" className="w-4 h-4 mr-2" alt="Procore" />
                      Procore
                    </Button>
                    <Button variant="outline" onClick={() => setShowSharePointDialog(true)}>
                      <img src="/icons/icon_sharepoint.png" className="w-4 h-4 mr-2" alt="SharePoint" />
                      SharePoint
                    </Button>
                  </div>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.dwg,.dxf"
                  multiple
                  className="hidden"
                  onChange={handleFileUpload}
                />
              </div>
            )}

            {/* Importing Progress UI */}
            {isImporting(request.status) && (
              <div className="border rounded-lg p-6 space-y-4">
                <div className="flex items-center gap-3">
                  <Loader2 className="w-5 h-5 animate-spin text-primary" />
                  <div>
                    <h3 className="text-lg font-medium text-foreground">
                      Importing Files{request.source_type === "google_drive" ? " from Google Drive" : request.source_type === "procore" ? " from Procore" : ""}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      Files are being copied to the analysis workspace
                    </p>
                  </div>
                </div>

                {(() => {
                  const total = files?.length || request.file_count || 0;
                  const copied = files?.filter(f => f.copy_status === "copied").length || 0;
                  const pct = total > 0 ? Math.round((copied / total) * 100) : 0;
                  return (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm text-muted-foreground">
                        <span>{copied} of {total} files imported</span>
                        <span>{pct}%</span>
                      </div>
                      <Progress value={pct} className="h-2" />
                    </div>
                  );
                })()}

                {files && files.length > 0 && (
                  <div className="max-h-48 overflow-y-auto space-y-1 p-3 bg-muted/30 rounded-md">
                    {files.map((file) => (
                      <div key={file.id} className="text-sm flex items-center gap-2">
                        {file.copy_status === "copied" ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        ) : file.copy_status === "pending" ? (
                          <Circle className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
                        ) : (
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-primary shrink-0" />
                        )}
                        <span className={`truncate ${file.copy_status === "copied" ? "text-foreground" : "text-muted-foreground"}`}>
                          {file.name}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Analysis Section */}
            {files && files.length > 0 && !isImporting(request.status) && (
              <AnalysisSection
                requestId={requestId!}
                files={files}
                projectId={request.project_id}
                sourceType={request.source_type}
              />
            )}

            {/* Export Button */}
            {request.status === "complete" && request.summary_data && Object.keys(request.summary_data as Record<string, unknown>).length > 0 && (
              <div className="flex justify-end pt-2">
                <Button onClick={handleExportClick}>
                  <Download className="w-4 h-4 mr-2" />
                  Export Analysis
                </Button>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Cloud source dialogs */}
      {request && (
        <>
          <RepositoryConnectionDialog
            isOpen={showDriveDialog}
            onClose={() => setShowDriveDialog(false)}
            projectId={request.project_id}
            projectName={request.project?.name}
            analysisRequestId={requestId}
            onAnalysisStarted={handleCloudAnalysisStarted}
          />
          <ProcoreConnectionDialog
            isOpen={showProcoreDialog}
            onClose={() => setShowProcoreDialog(false)}
            projectId={request.project_id}
            projectName={request.project?.name}
            analysisRequestId={requestId}
            onAnalysisStarted={handleCloudAnalysisStarted}
          />
        </>
      )}

      <ActiveExportModal
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onConfirm={confirmCancelAndRestart}
      />
    </div>
  );
}
