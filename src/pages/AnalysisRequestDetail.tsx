import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AppHeader } from "@/components/AppHeader";
import { AnalysisSection } from "@/components/analysis/AnalysisSection";
import { useHeapIdentify } from "@/hooks/useHeapIdentify";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  Download,
  Loader2,
  ShieldAlert,
} from "lucide-react";
import { format } from "date-fns";
import * as pdfjsLib from "pdfjs-dist";

// Set up PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

interface AnalysisFile {
  id: string;
  name: string;
  mime_type: string;
  size_bytes: number | null;
  relative_path: string;
  storage_path: string | null;
  copy_status: string;
}

const fileStatusColors: Record<string, string> = {
  pending: "text-blue-600 border-blue-300",
  copying: "text-blue-600 border-blue-300",
  copied: "text-emerald-600 border-emerald-300",
  failed: "text-red-600 border-red-300",
};

const formatBytes = (bytes: number | null): string => {
  if (!bytes) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

const statusColors: Record<string, string> = {
  pending: "bg-blue-100 text-blue-800 border-blue-300",
  copying: "bg-blue-100 text-blue-800 border-blue-300",
  copied: "bg-amber-100 text-amber-800 border-amber-300",
  processing: "bg-purple-100 text-purple-800 border-purple-300",
  complete: "bg-emerald-100 text-emerald-800 border-emerald-300",
  failed: "bg-red-100 text-red-800 border-red-300",
};

const statusLabels: Record<string, string> = {
  pending: "Importing Drawings",
  copying: "Importing Drawings",
  copied: "Ready for Analysis",
  processing: "Analyzing",
  complete: "Analysis Complete",
  failed: "Failed",
};

function getStorageBucket(sourceType: string | undefined): string {
  return sourceType === "manual_upload" ? "uploaded-drawings" : "drive-analysis-files";
}

export default function AnalysisRequestDetail() {
  const { requestId } = useParams<{ requestId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  useHeapIdentify();
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [selectedFile, setSelectedFile] = useState<AnalysisFile | null>(null);
  const [downloadingFile, setDownloadingFile] = useState(false);
  const [pdfPages, setPdfPages] = useState<HTMLCanvasElement[]>([]);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfPageCount, setPdfPageCount] = useState(0);
  const pdfContainerRef = useRef<HTMLDivElement>(null);

  const isInternal = user?.email?.toLowerCase().endsWith("@riskclock.com") ?? false;

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
  });

  const { data: files, isLoading: filesLoading } = useQuery({
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
  });

  // Load PDF when a PDF file is selected
  useEffect(() => {
    if (!selectedFile) {
      setPdfPages([]);
      setPdfPageCount(0);
      return;
    }

    const isPdf = selectedFile.mime_type === "application/pdf" || selectedFile.name.toLowerCase().endsWith(".pdf");
    if (!isPdf || !selectedFile.storage_path) {
      setPdfPages([]);
      setPdfPageCount(0);
      return;
    }

    let cancelled = false;
    const loadPdf = async () => {
      setPdfLoading(true);
      setPdfPages([]);
      try {
        const bucket = getStorageBucket(request?.source_type);
        const { data: blob, error } = await supabase.storage
          .from(bucket)
          .download(selectedFile.storage_path!);
        if (error || !blob) throw error || new Error("Download failed");

        const arrayBuffer = await blob.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        if (cancelled) return;

        setPdfPageCount(pdf.numPages);
        const canvases: HTMLCanvasElement[] = [];
        const maxPages = Math.min(pdf.numPages, 20); // Limit to 20 pages

        for (let i = 1; i <= maxPages; i++) {
          const page = await pdf.getPage(i);
          const scale = 1.5;
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext("2d")!;
          await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;
          if (cancelled) return;
          canvases.push(canvas);
        }

        setPdfPages(canvases);
      } catch (e) {
        console.error("PDF load error:", e);
        if (!cancelled) {
          toast({ title: "PDF Preview Failed", description: "Could not render PDF preview.", variant: "destructive" });
        }
      } finally {
        if (!cancelled) setPdfLoading(false);
      }
    };

    loadPdf();
    return () => { cancelled = true; };
  }, [selectedFile, request?.source_type, toast]);

  // Render PDF canvases into container
  useEffect(() => {
    if (!pdfContainerRef.current || pdfPages.length === 0) return;
    const container = pdfContainerRef.current;
    container.innerHTML = "";
    for (const canvas of pdfPages) {
      canvas.style.width = "100%";
      canvas.style.height = "auto";
      canvas.style.marginBottom = "8px";
      container.appendChild(canvas);
    }
  }, [pdfPages]);

  const handleDownloadZip = async () => {
    if (!requestId) return;
    setDownloadingZip(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/download-analysis-files-zip?analysisRequestId=${requestId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Download failed");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `analysis_${requestId.slice(0, 8)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: "Download Started", description: "Your ZIP file is downloading." });
    } catch (error) {
      toast({ title: "Download Failed", description: error instanceof Error ? error.message : "Failed to download files", variant: "destructive" });
    } finally {
      setDownloadingZip(false);
    }
  };

  const handleDownloadFile = async (file: AnalysisFile) => {
    if (!file.storage_path) return;
    setDownloadingFile(true);
    try {
      const bucket = getStorageBucket(request?.source_type);
      const { data, error } = await supabase.storage
        .from(bucket)
        .download(file.storage_path);
      if (error) throw error;
      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      toast({ title: "Download Failed", description: error instanceof Error ? error.message : "Failed to download file", variant: "destructive" });
    } finally {
      setDownloadingFile(false);
    }
  };

  const getFilePreviewUrl = (file: AnalysisFile): string | null => {
    if (!file.storage_path || !file.mime_type?.startsWith("image/")) return null;
    const bucket = getStorageBucket(request?.source_type);
    const { data } = supabase.storage.from(bucket).getPublicUrl(file.storage_path);
    return data?.publicUrl || null;
  };

  const totalSize = files?.reduce((sum, f) => sum + (f.size_bytes || 0), 0) || 0;
  const sourceLabel = ((request?.source_type || "google_drive") as string).replace("_", " ");

  const isPdfFile = selectedFile && (selectedFile.mime_type === "application/pdf" || selectedFile.name.toLowerCase().endsWith(".pdf"));

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

      <main className="container mx-auto px-6 py-8 max-w-4xl">
        <Button variant="ghost" size="sm" className="mb-4" onClick={() => navigate("/internal/analysis-queue")}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Analysis Queue
        </Button>

        {requestLoading ? (
          <div className="text-center py-12 text-muted-foreground">Loading...</div>
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
              <Badge variant="outline" className={statusColors[request.status] || ""}>
                {statusLabels[request.status] || request.status}
              </Badge>
            </div>

            {/* File table with consolidated header */}
            <div className="bg-card border rounded-lg">
              <div className="px-4 py-3 border-b flex items-center justify-between">
                <h2 className="font-semibold text-sm">
                  Files
                  <span className="font-normal text-muted-foreground ml-2">
                    (Count: {files?.length || 0}, {formatBytes(totalSize)}, <span className="capitalize">{sourceLabel}</span>)
                  </span>
                </h2>
                <Button size="sm" onClick={handleDownloadZip} disabled={downloadingZip}>
                  {downloadingZip ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                  Download ZIP
                </Button>
              </div>

              {filesLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              ) : !files?.length ? (
                <div className="text-center py-8 text-muted-foreground">No files found.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>File Name</TableHead>
                      <TableHead className="w-[120px]">Status</TableHead>
                      <TableHead className="w-[100px] text-right">Size</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {files.map((file) => (
                      <TableRow key={file.id}>
                        <TableCell>
                          <button
                            className="text-primary hover:underline text-left text-sm cursor-pointer"
                            onClick={() => setSelectedFile(file)}
                          >
                            {file.relative_path}
                          </button>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`text-xs ${fileStatusColors[file.copy_status] || ""}`}>
                            {file.copy_status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">
                          {formatBytes(file.size_bytes)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>

            {request.error_message && (
              <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
                <p className="text-sm font-medium text-destructive">Error</p>
                <p className="text-sm text-destructive/80 mt-1">{request.error_message}</p>
              </div>
            )}

            {/* Analysis Section */}
            {files && files.length > 0 && (
              <AnalysisSection requestId={requestId!} files={files} projectId={request.project_id} />
            )}
          </div>
        )}
      </main>

      {/* File Preview Modal */}
      <Dialog open={!!selectedFile} onOpenChange={(open) => !open && setSelectedFile(null)}>
        <DialogContent className={isPdfFile ? "sm:max-w-3xl max-h-[90vh]" : "sm:max-w-lg"}>
          <DialogHeader>
            <DialogTitle className="truncate">{selectedFile?.name}</DialogTitle>
          </DialogHeader>
          {selectedFile && (
            <div className="space-y-4">
              {isPdfFile ? (
                <div className="rounded-lg overflow-auto border bg-muted/30 max-h-[60vh]">
                  {pdfLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="w-6 h-6 animate-spin mr-2" />
                      <span className="text-sm text-muted-foreground">Loading PDF...</span>
                    </div>
                  ) : pdfPages.length > 0 ? (
                    <div ref={pdfContainerRef} className="p-2">
                      {/* canvases rendered via useEffect */}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      Could not render PDF preview.
                    </div>
                  )}
                  {pdfPageCount > 0 && (
                    <div className="text-xs text-muted-foreground text-center py-1 border-t">
                      {pdfPageCount} page{pdfPageCount !== 1 ? "s" : ""}{pdfPageCount > 20 ? " (showing first 20)" : ""}
                    </div>
                  )}
                </div>
              ) : selectedFile.mime_type?.startsWith("image/") && selectedFile.storage_path ? (
                <div className="rounded-lg overflow-hidden border bg-muted/30">
                  <img
                    src={getFilePreviewUrl(selectedFile) || ""}
                    alt={selectedFile.name}
                    className="w-full h-auto max-h-[400px] object-contain"
                  />
                </div>
              ) : (
                <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Type</span>
                    <span>{selectedFile.mime_type}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Size</span>
                    <span>{formatBytes(selectedFile.size_bytes)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Status</span>
                    <Badge variant="outline" className={`text-xs ${fileStatusColors[selectedFile.copy_status] || ""}`}>
                      {selectedFile.copy_status}
                    </Badge>
                  </div>
                </div>
              )}
              <Button
                className="w-full"
                onClick={() => handleDownloadFile(selectedFile)}
                disabled={downloadingFile || !selectedFile.storage_path}
              >
                {downloadingFile ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                Download
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
