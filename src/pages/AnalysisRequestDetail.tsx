import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { LogoDropdown } from "@/components/LogoDropdown";
import { useHeapIdentify } from "@/hooks/useHeapIdentify";
import {
  ArrowLeft,
  Download,
  Loader2,
  FileText,
  Folder,
  ChevronRight,
  ChevronDown,
  ShieldAlert,
} from "lucide-react";
import { format } from "date-fns";

interface AnalysisFile {
  id: string;
  name: string;
  mime_type: string;
  size_bytes: number | null;
  relative_path: string;
  storage_path: string | null;
  copy_status: string;
}

interface FileTreeNode {
  name: string;
  path: string;
  isFolder: boolean;
  children: FileTreeNode[];
  file?: AnalysisFile;
}

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

const formatBytes = (bytes: number | null): string => {
  if (!bytes) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

const buildFileTree = (files: AnalysisFile[]): FileTreeNode[] => {
  const root: FileTreeNode[] = [];
  for (const file of files) {
    const parts = file.relative_path.split("/");
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const path = parts.slice(0, i + 1).join("/");
      let node = current.find((n) => n.name === part);
      if (!node) {
        node = { name: part, path, isFolder: !isLast, children: [], file: isLast ? file : undefined };
        current.push(node);
      }
      current = node.children;
    }
  }
  return root;
};

const FileTreeItem = ({ node, depth = 0 }: { node: FileTreeNode; depth?: number }) => {
  const [expanded, setExpanded] = useState(true);
  return (
    <div>
      <div
        className="flex items-center gap-2 py-1 px-2 hover:bg-muted/50 rounded cursor-pointer"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => node.isFolder && setExpanded(!expanded)}
      >
        {node.isFolder ? (
          <>
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            <Folder className="w-4 h-4 text-blue-500" />
          </>
        ) : (
          <>
            <span className="w-4" />
            <FileText className="w-4 h-4 text-muted-foreground" />
          </>
        )}
        <span className="text-sm truncate flex-1">{node.name}</span>
        {node.file && (
          <Badge
            variant="outline"
            className={`text-xs ${
              node.file.copy_status === "copied"
                ? "text-green-600 border-green-300"
                : node.file.copy_status === "failed"
                ? "text-red-600 border-red-300"
                : "text-yellow-600 border-yellow-300"
            }`}
          >
            {node.file.copy_status}
          </Badge>
        )}
        {node.file?.size_bytes && <span className="text-xs text-muted-foreground">{formatBytes(node.file.size_bytes)}</span>}
      </div>
      {node.isFolder && expanded && node.children.map((child, idx) => <FileTreeItem key={child.path || idx} node={child} depth={depth + 1} />)}
    </div>
  );
};

export default function AnalysisRequestDetail() {
  const { requestId } = useParams<{ requestId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  useHeapIdentify();
  const [downloadingZip, setDownloadingZip] = useState(false);

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

      // Fetch user email
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

  const fileTree = files ? buildFileTree(files) : [];

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
      <header className="sticky top-0 z-20 border-b bg-card">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <LogoDropdown />
          <div className="flex items-center gap-6">
            <button onClick={() => navigate("/projects")} className="text-foreground hover:text-primary">Projects</button>
          </div>
        </div>
      </header>

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

            {/* Stats */}
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-card border rounded-lg p-4">
                <p className="text-sm text-muted-foreground">Files</p>
                <p className="text-2xl font-bold">{request.file_count || 0}</p>
              </div>
              <div className="bg-card border rounded-lg p-4">
                <p className="text-sm text-muted-foreground">Total Size</p>
                <p className="text-2xl font-bold">{formatBytes(request.total_size_bytes)}</p>
              </div>
              <div className="bg-card border rounded-lg p-4">
                <p className="text-sm text-muted-foreground">Source</p>
                <p className="text-2xl font-bold capitalize">{(request.source_type || "google_drive").replace("_", " ")}</p>
              </div>
            </div>

            {/* Download */}
            <div className="flex justify-end">
              <Button onClick={handleDownloadZip} disabled={downloadingZip}>
                {downloadingZip ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                Download ZIP
              </Button>
            </div>

            {/* File tree */}
            <div className="bg-card border rounded-lg">
              <div className="px-4 py-3 border-b">
                <h2 className="font-semibold">Files</h2>
              </div>
              <ScrollArea className="max-h-[500px]">
                <div className="p-2">
                  {filesLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin" />
                    </div>
                  ) : !files?.length ? (
                    <div className="text-center py-8 text-muted-foreground">No files found.</div>
                  ) : (
                    fileTree.map((node, idx) => <FileTreeItem key={node.path || idx} node={node} />)
                  )}
                </div>
              </ScrollArea>
            </div>

            {request.error_message && (
              <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
                <p className="text-sm font-medium text-destructive">Error</p>
                <p className="text-sm text-destructive/80 mt-1">{request.error_message}</p>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
