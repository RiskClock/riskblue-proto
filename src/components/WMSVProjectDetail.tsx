import { useRef, useState, useMemo, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppHeader } from "@/components/AppHeader";
import { AnalysisSection } from "@/components/analysis/AnalysisSection";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Loader2, Upload, FileText, CheckCircle2, Circle, FolderSync, Download } from "lucide-react";
import { RepositoryConnectionDialog } from "@/components/wizard/RepositoryConnectionDialog";
import { ProcoreConnectionDialog } from "@/components/wizard/ProcoreConnectionDialog";
import { SharePointConnectionDialog } from "@/components/wizard/SharePointConnectionDialog";
import { generateAnalysisDocx } from "@/lib/analysisDocxExporter";

const ACTIVE_STATUSES = ["pending", "copying", "copied", "started", "processing"];

interface WMSVProjectDetailProps {
  projectId: string;
  projectName: string;
}

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

const isImporting = (s?: string) => s === "pending" || s === "copying";

export function WMSVProjectDetail({ projectId, projectName }: WMSVProjectDetailProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showDriveDialog, setShowDriveDialog] = useState(false);
  const [showProcoreDialog, setShowProcoreDialog] = useState(false);
  const [showSharePointDialog, setShowSharePointDialog] = useState(false);

  // Fetch user's enabled control selections
  const { data: controlSelections } = useQuery({
    queryKey: ["wmsv-control-selections", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wmsv_control_selections")
        .select("category, control_id")
        .eq("user_id", user!.id);
      if (error) throw error;
      return data as Array<{ category: string; control_id: string }>;
    },
    enabled: !!user?.id,
    staleTime: 1000 * 60 * 10,
  });

  // Fetch AWP source tables with default_control_ids
  const { data: awpSourceData } = useQuery({
    queryKey: ["wmsv-awp-source-controls"],
    queryFn: async () => {
      const [a, w, p] = await Promise.all([
        supabase.from("critical_assets").select("name, default_control_ids").eq("is_active", true),
        supabase.from("water_systems").select("name, default_control_ids").eq("is_active", true),
        supabase.from("processes").select("name, default_control_ids").eq("is_active", true),
      ]);
      return [
        ...(a.data || []).map((x) => ({ name: x.name, controlIds: (x.default_control_ids as string[]) || [], category: "critical_assets" })),
        ...(w.data || []).map((x) => ({ name: x.name, controlIds: (x.default_control_ids as string[]) || [], category: "water_systems" })),
        ...(p.data || []).map((x) => ({ name: x.name, controlIds: (x.default_control_ids as string[]) || [], category: "processes" })),
      ];
    },
    staleTime: 1000 * 60 * 30,
  });

  // Compute visible AWP classes: any class where at least one default control is enabled (cross-category)
  const visibleAwpClasses = useMemo(() => {
    if (!controlSelections || !awpSourceData) return undefined;
    const enabledControlIds = new Set(controlSelections.map(sel => sel.control_id));
    return awpSourceData
      .filter((awp) => awp.controlIds.some((cid) => enabledControlIds.has(cid)))
      .map((awp) => awp.name);
  }, [controlSelections, awpSourceData]);

  // Fetch the latest analysis request for this project
  const { data: request, isLoading: requestLoading } = useQuery({
    queryKey: ["wmsv-analysis-request", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("analysis_requests")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!projectId,
    refetchInterval: (q: any) => {
      const status = q.state.data?.status;
      return ACTIVE_STATUSES.includes(status) ? 5000 : false;
    },
  });

  // Realtime subscription for analysis_requests changes
  useEffect(() => {
    if (!projectId) return;
    const channel: RealtimeChannel = supabase
      .channel(`wmsv-ar-${projectId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "analysis_requests", filter: `project_id=eq.${projectId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ["wmsv-analysis-request", projectId] });
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [projectId, queryClient]);

  const { data: files } = useQuery({
    queryKey: ["wmsv-analysis-files", request?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("analysis_request_files")
        .select("*")
        .eq("analysis_request_id", request!.id)
        .order("relative_path");
      if (error) throw error;
      return data as AnalysisFile[];
    },
    refetchInterval: (() => {
      const s = request?.status;
      return ACTIVE_STATUSES.includes(s || "") ? 5000 : false;
    })() as number | false,
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles?.length || !request || !user) return;
    e.target.value = "";
    setUploading(true);

    try {
      let totalBytes = 0;
      for (const file of Array.from(selectedFiles)) {
        const filePath = `${projectId}/${request.id}/${file.name}`;
        const { error: uploadError } = await supabase.storage
          .from("uploaded-drawings")
          .upload(filePath, file);
        if (uploadError) throw uploadError;
        totalBytes += file.size;

        await supabase.from("analysis_request_files").insert({
          analysis_request_id: request.id,
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
        .eq("id", request.id);

      toast({ title: "Files Uploaded", description: `${selectedFiles.length} file(s) uploaded successfully.` });
      queryClient.invalidateQueries({ queryKey: ["wmsv-analysis-request", projectId] });
      queryClient.invalidateQueries({ queryKey: ["wmsv-analysis-files", request.id] });
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
    queryClient.invalidateQueries({ queryKey: ["wmsv-analysis-request", projectId] });
  };

  const handleExportDocx = useCallback(async () => {
    if (!request) return;
    const summaryData = (request.summary_data as unknown as Record<string, any[]>) || {};
    const hasInstances = Object.values(summaryData).some((arr) => arr?.length > 0);
    if (!hasInstances) {
      toast({ title: "No Data", description: "No summarized instances to export.", variant: "destructive" });
      return;
    }
    setExporting(true);
    try {
      const blob = await generateAnalysisDocx(request.id, summaryData as any, projectName || "Project");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(projectName || "Analysis").replace(/[^a-zA-Z0-9]/g, "_")}_Export.docx`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Export Complete", description: "DOCX file downloaded." });
    } catch (e) {
      toast({ title: "Export Failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  }, [request, projectName, toast]);

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />

      <main className="container mx-auto px-6 py-8 max-w-[1400px]">
        <Button variant="ghost" size="sm" className="mb-4" onClick={() => navigate("/projects")}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Projects
        </Button>

        <div className="flex items-start justify-between mb-6">
          <h1 className="text-2xl font-bold text-foreground">{projectName}</h1>
          {request && (
            <Badge variant="outline" className={statusColors[request.status] || ""}>
              {statusLabels[request.status] || request.status}
            </Badge>
          )}
        </div>

        {requestLoading ? (
          <div className="text-center py-12 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
            Loading...
          </div>
        ) : !request ? (
          <div className="text-center py-12 text-muted-foreground">
            <p>No analysis request found for this project.</p>
          </div>
        ) : (
            <div className="space-y-6">
              {request.error_message && (
                <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
                  <p className="text-sm font-medium text-destructive">Error</p>
                  <p className="text-sm text-destructive/80 mt-1">{request.error_message}</p>
                </div>
              )}

              {/* Upload / re-import actions — only show when no files yet */}
              {(request.status === "awaiting_upload" || request.status === "failed") && (!files || files.length === 0) && (
                <div className="border rounded-lg p-6 space-y-4">
                  <div className="text-center space-y-4">
                    <FileText className="w-12 h-12 text-muted-foreground/50 mx-auto" />
                    <div>
                      <h3 className="text-lg font-medium text-foreground">
                        {request.status === "failed" ? "Import failed" : "No files uploaded yet"}
                      </h3>
                      <p className="text-sm text-muted-foreground mt-1">
                        {request.status === "failed"
                          ? "Try importing the drawing files again from one of the sources below"
                          : "Upload drawing files to begin analysis"}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                      {uploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                      Upload from Computer
                    </Button>
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

              {/* Import progress */}
              {isImporting(request.status) && (
                <div className="border rounded-lg p-6 space-y-4">
                  <div className="flex items-center gap-3">
                    <Loader2 className="w-5 h-5 animate-spin text-primary" />
                    <div>
                      <h3 className="text-lg font-medium text-foreground">
                        Importing Files{request.source_type === "google_drive" ? " from Google Drive" : request.source_type === "procore" ? " from Procore" : request.source_type === "sharepoint" ? " from SharePoint" : ""}
                      </h3>
                      <p className="text-sm text-muted-foreground">Files are being copied to the analysis workspace</p>
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

              {/* Analysis section */}
              {files && files.length > 0 && !isImporting(request.status) && (
                <>
                  <AnalysisSection
                    requestId={request.id}
                    files={files}
                    projectId={projectId}
                    sourceType={request.source_type}
                    isWMSV={true}
                    visibleAwpClasses={visibleAwpClasses}
                    onAddFileUpload={() => fileInputRef.current?.click()}
                    onAddFileDrive={() => setShowDriveDialog(true)}
                    onAddFileProcore={() => setShowProcoreDialog(true)}
                    onAddFileSharePoint={() => setShowSharePointDialog(true)}
                  />
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,.dwg,.dxf"
                    multiple
                    className="hidden"
                    onChange={handleFileUpload}
                  />
                </>
              )}

              {request.status === "complete" && request.summary_data && Object.keys(request.summary_data as Record<string, unknown>).length > 0 && (
                <div className="flex justify-end pt-2">
                  <Button onClick={handleExportDocx} disabled={exporting}>
                    {exporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                    {exporting ? "Exporting…" : "Export Analysis"}
                  </Button>
                </div>
              )}
            </div>
        )}
      </main>

      {request && (
        <>
          <RepositoryConnectionDialog
            isOpen={showDriveDialog}
            onClose={() => setShowDriveDialog(false)}
            projectId={projectId}
            projectName={projectName}
            analysisRequestId={request.id}
            onAnalysisStarted={handleCloudAnalysisStarted}
          />
          <ProcoreConnectionDialog
            isOpen={showProcoreDialog}
            onClose={() => setShowProcoreDialog(false)}
            projectId={projectId}
            projectName={projectName}
            analysisRequestId={request.id}
            onAnalysisStarted={handleCloudAnalysisStarted}
          />
        </>
      )}
    </div>
  );
}
