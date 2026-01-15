import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { LogoDropdown } from "@/components/LogoDropdown";
import { ProviderSelectionDialog } from "@/components/ProviderSelectionDialog";
import { useHeapIdentify } from "@/hooks/useHeapIdentify";
import { useUserDisplayName } from "@/hooks/useUserDisplayName";
import { DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { 
  Download, 
  Eye, 
  Loader2, 
  RefreshCw, 
  FileText,
  Folder,
  ChevronRight,
  ChevronDown,
  ExternalLink,
  LogOut,
  ShieldAlert,
  Settings,
  BarChart3,
  RotateCcw
} from "lucide-react";
import { format } from "date-fns";

interface AnalysisRequest {
  id: string;
  project_id: string;
  user_id: string;
  drive_folder_id: string;
  status: string;
  file_count: number;
  total_size_bytes: number | null;
  storage_path: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  project?: { name: string };
  profile?: { display_name: string | null };
  user_email?: string;
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

// File tree node for display
interface FileTreeNode {
  name: string;
  path: string;
  isFolder: boolean;
  children: FileTreeNode[];
  file?: AnalysisFile;
}

const statusColors: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800 border-yellow-300",
  copying: "bg-blue-100 text-blue-800 border-blue-300",
  copied: "bg-green-100 text-green-800 border-green-300",
  processing: "bg-purple-100 text-purple-800 border-purple-300",
  complete: "bg-emerald-100 text-emerald-800 border-emerald-300",
  failed: "bg-red-100 text-red-800 border-red-300",
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
      
      let node = current.find(n => n.name === part);
      
      if (!node) {
        node = {
          name: part,
          path,
          isFolder: !isLast,
          children: [],
          file: isLast ? file : undefined,
        };
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
          <Badge variant="outline" className={`text-xs ${
            node.file.copy_status === "copied" 
              ? "text-green-600 border-green-300" 
              : node.file.copy_status === "failed"
              ? "text-red-600 border-red-300"
              : "text-yellow-600 border-yellow-300"
          }`}>
            {node.file.copy_status}
          </Badge>
        )}
        {node.file?.size_bytes && (
          <span className="text-xs text-muted-foreground">
            {formatBytes(node.file.size_bytes)}
          </span>
        )}
      </div>
      {node.isFolder && expanded && node.children.map((child, idx) => (
        <FileTreeItem key={child.path || idx} node={child} depth={depth + 1} />
      ))}
    </div>
  );
};

export default function InternalAnalysisQueue() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  useHeapIdentify();
  const { getInitial } = useUserDisplayName();
  const [selectedRequest, setSelectedRequest] = useState<AnalysisRequest | null>(null);
  const [showFilesModal, setShowFilesModal] = useState(false);
  const [downloadingZip, setDownloadingZip] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [showProviderDialog, setShowProviderDialog] = useState(false);

  // Check if user is internal
  const isInternal = user?.email?.toLowerCase().endsWith("@riskclock.com") ?? false;

  // Fetch analysis requests
  const { data: requests, isLoading, refetch } = useQuery({
    queryKey: ["analysis-requests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("analysis_requests")
        .select(`
          *,
          project:projects(name)
        `)
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Fetch user emails via edge function
      const userIds = [...new Set((data || []).map(r => r.user_id))];
      let emailsMap = new Map<string, string>();
      
      if (userIds.length > 0) {
        try {
          const { data: emailsResult } = await supabase.functions.invoke(
            `get-user-emails?userIds=${userIds.join(",")}`,
            { method: "GET" }
          );
          if (emailsResult?.emails) {
            emailsMap = new Map(Object.entries(emailsResult.emails));
          }
        } catch (e) {
          console.error("Failed to fetch emails:", e);
        }
      }

      return (data || []).map(r => ({
        ...r,
        user_email: emailsMap.get(r.user_id) || "Unknown",
      }));
    },
    enabled: isInternal,
  });

  // Subscribe to realtime updates for analysis_requests
  useEffect(() => {
    if (!isInternal) return;

    const channel = supabase
      .channel('analysis-requests-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'analysis_requests'
        },
        (payload) => {
          console.log('Analysis request updated:', payload);
          // Refetch to get updated data with joins
          refetch();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isInternal, refetch]);

  // Fetch files for selected request
  const { data: files, isLoading: filesLoading } = useQuery({
    queryKey: ["analysis-files", selectedRequest?.id],
    queryFn: async () => {
      if (!selectedRequest) return [];
      const { data, error } = await supabase
        .from("analysis_request_files")
        .select("*")
        .eq("analysis_request_id", selectedRequest.id)
        .order("relative_path");
      
      if (error) throw error;
      return data as AnalysisFile[];
    },
    enabled: !!selectedRequest,
  });

  const handleViewFiles = (request: AnalysisRequest) => {
    setSelectedRequest(request);
    setShowFilesModal(true);
  };

  const handleDownloadZip = async (request: AnalysisRequest) => {
    setDownloadingZip(request.id);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/download-analysis-files-zip?analysisRequestId=${request.id}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Download failed");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `analysis_${request.id.slice(0, 8)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: "Download Started",
        description: "Your ZIP file is downloading.",
      });
    } catch (error) {
      console.error("Download error:", error);
      toast({
        title: "Download Failed",
        description: error instanceof Error ? error.message : "Failed to download files",
        variant: "destructive",
      });
    } finally {
      setDownloadingZip(null);
    }
  };

  const handleRetry = async (request: AnalysisRequest) => {
    setRetrying(request.id);
    try {
      // Reset status to pending
      const { error: updateError } = await supabase
        .from("analysis_requests")
        .update({ status: "pending", error_message: null })
        .eq("id", request.id);

      if (updateError) throw updateError;

      // Reset file statuses
      await supabase
        .from("analysis_request_files")
        .update({ copy_status: "pending", storage_path: null })
        .eq("analysis_request_id", request.id);

      // Trigger the copy function again
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/copy-drive-files`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ analysisRequestId: request.id }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Retry failed");
      }

      toast({
        title: "Retry Started",
        description: "File copying has been restarted.",
      });
    } catch (error) {
      console.error("Retry error:", error);
      toast({
        title: "Retry Failed",
        description: error instanceof Error ? error.message : "Failed to retry copying",
        variant: "destructive",
      });
    } finally {
      setRetrying(null);
    }
  };

  const fileTree = files ? buildFileTree(files) : [];

  // Access control
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
            <button onClick={() => navigate("/projects")} className="text-foreground hover:text-primary">
              Projects
            </button>
            <button onClick={() => setShowProviderDialog(true)} className="text-foreground hover:text-primary">
              Solution Provider Portal
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Avatar className="cursor-pointer">
                  <AvatarFallback>{getInitial()}</AvatarFallback>
                </Avatar>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={() => navigate("/configuration")} className="cursor-pointer">
                  <Settings className="h-4 w-4 mr-2" />
                  Configuration
                </DropdownMenuItem>
                <DropdownMenuItem className="cursor-pointer">
                  <FileText className="h-4 w-4 mr-2" />
                  Analysis Queue
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate("/logs")} className="cursor-pointer">
                  <BarChart3 className="h-4 w-4 mr-2" />
                  Logs
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={signOut} className="cursor-pointer">
                  <LogOut className="h-4 w-4 mr-2" />
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Analysis Queue</h1>
            <p className="text-muted-foreground">Manage Google Drive analysis requests</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>

        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">Loading...</div>
        ) : !requests?.length ? (
          <div className="text-center py-12 text-muted-foreground">No analysis requests found.</div>
        ) : (
          <div className="bg-card rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Requested By</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Files</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((request) => (
                  <TableRow key={request.id}>
                    <TableCell>
                      <Button
                        variant="link"
                        className="p-0 h-auto font-medium"
                        onClick={() => navigate(`/project/${request.project_id}`)}
                      >
                        {request.project?.name || "Unknown Project"}
                        <ExternalLink className="w-3 h-3 ml-1" />
                      </Button>
                    </TableCell>
                    <TableCell className="text-sm">{request.user_email}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(request.created_at), "MMM d, yyyy HH:mm")}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusColors[request.status] || ""}>
                        {request.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{request.file_count || 0}</TableCell>
                    <TableCell>{formatBytes(request.total_size_bytes)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleViewFiles(request)}
                        >
                          <Eye className="w-4 h-4 mr-1" />
                          View
                        </Button>
                        {(request.status === "failed" || request.status === "pending") && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleRetry(request)}
                            disabled={retrying === request.id}
                          >
                            {retrying === request.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <RotateCcw className="w-4 h-4" />
                            )}
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDownloadZip(request)}
                          disabled={downloadingZip === request.id || request.status !== "copied"}
                        >
                          {downloadingZip === request.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Download className="w-4 h-4" />
                          )}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </main>

      {/* Files Modal */}
      <Dialog open={showFilesModal} onOpenChange={setShowFilesModal}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>
              Files for {selectedRequest?.project?.name || "Project"}
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="flex-1 min-h-0">
            {filesLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : !files?.length ? (
              <div className="text-center py-8 text-muted-foreground">
                No files found.
              </div>
            ) : (
              <div className="space-y-1">
                {fileTree.map((node, idx) => (
                  <FileTreeItem key={node.path || idx} node={node} />
                ))}
              </div>
            )}
          </ScrollArea>
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={() => setShowFilesModal(false)}>
              Close
            </Button>
            {selectedRequest && selectedRequest.status === "copied" && (
              <Button onClick={() => handleDownloadZip(selectedRequest)}>
                <Download className="w-4 h-4 mr-2" />
                Download ZIP
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ProviderSelectionDialog open={showProviderDialog} onOpenChange={setShowProviderDialog} />
    </div>
  );
}