import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AppHeader } from "@/components/AppHeader";
import { useHeapIdentify } from "@/hooks/useHeapIdentify";
import { 
  Eye, 
  Loader2, 
  RefreshCw, 
  FileText,
  ExternalLink,
  LogOut,
  ShieldAlert,
  Settings,
  BarChart3,
  RotateCcw,
  Trash2,
  Plus
} from "lucide-react";
import { CreateAnalysisModal } from "@/components/analysis/CreateAnalysisModal";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { format } from "date-fns";
import { deriveAnalysisUiState, presentAnalysisUiState, uiStateBadgeClass } from "@/lib/analysisUiState";

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

const formatBytes = (bytes: number | null): string => {
  if (!bytes) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

export default function InternalAnalysisQueue() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  useHeapIdentify();
  const [retrying, setRetrying] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const isInternal = user?.email?.toLowerCase().endsWith("@riskclock.com") ?? false;

  const { data: requests, isLoading, refetch } = useQuery({
    queryKey: ["analysis-requests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("analysis_requests")
        .select(`*, project:projects(name)`)
        .order("created_at", { ascending: false });

      if (error) throw error;

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

  useEffect(() => {
    if (!isInternal) return;
    const channel = supabase
      .channel('analysis-requests-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'analysis_requests' }, () => refetch())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [isInternal, refetch]);

  const handleRetry = async (request: AnalysisRequest) => {
    setRetrying(request.id);
    try {
      const { error: updateError } = await supabase
        .from("analysis_requests")
        .update({ status: "pending", error_message: null })
        .eq("id", request.id);
      if (updateError) throw updateError;

      await supabase
        .from("analysis_request_files")
        .update({ copy_status: "pending", storage_path: null })
        .eq("analysis_request_id", request.id);

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/copy-drive-files`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ analysisRequestId: request.id }),
        }
      );
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Retry failed");
      }
      toast({ title: "Retry Started", description: "File copying has been restarted." });
    } catch (error) {
      toast({ title: "Retry Failed", description: error instanceof Error ? error.message : "Failed to retry copying", variant: "destructive" });
    } finally {
      setRetrying(null);
    }
  };

  const handleDelete = async (requestId: string) => {
    setDeleting(requestId);
    try {
      // Delete files first (foreign key dependency)
      const { error: filesError } = await supabase
        .from("analysis_request_files")
        .delete()
        .eq("analysis_request_id", requestId);
      if (filesError) throw filesError;

      // Then delete the analysis results
      await supabase
        .from("analysis_results")
        .delete()
        .eq("analysis_request_id", requestId);

      // Then delete the request itself
      const { error: requestError } = await supabase
        .from("analysis_requests")
        .delete()
        .eq("id", requestId);
      if (requestError) throw requestError;

      toast({ title: "Deleted", description: "Analysis request has been deleted." });
      refetch();
    } catch (error) {
      toast({ title: "Delete Failed", description: error instanceof Error ? error.message : "Failed to delete", variant: "destructive" });
    } finally {
      setDeleting(null);
    }
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

      <main className="container mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Analysis Queue</h1>
            <p className="text-muted-foreground">Manage drawing analysis requests</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="w-4 h-4 mr-2" />Refresh
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />Create New Analysis
            </Button>
          </div>
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
                {requests.map((request) => {
                  const uiState = deriveAnalysisUiState(request as any);
                  const presentation = presentAnalysisUiState(uiState);
                  return (
                  <TableRow key={request.id}>
                    <TableCell>
                      <Button variant="link" className="p-0 h-auto font-medium" onClick={() => navigate(`/project/${request.project_id}`)}>
                        {request.project?.name || "Unknown Project"}
                        <ExternalLink className="w-3 h-3 ml-1" />
                      </Button>
                    </TableCell>
                    <TableCell className="text-sm">{request.user_email}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(request.created_at), "MMM d, yyyy HH:mm")}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={uiStateBadgeClass(uiState)}>
                        {presentation.label}
                      </Badge>
                    </TableCell>
                    <TableCell>{request.file_count || 0}</TableCell>
                    <TableCell>{formatBytes(request.total_size_bytes)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => navigate(`/internal/analysis-queue/${request.id}`)}>
                          <Eye className="w-4 h-4 mr-1" />View
                        </Button>
                        {(request.status === "failed" || request.status === "pending") && (
                          <Button variant="outline" size="sm" onClick={() => handleRetry(request)} disabled={retrying === request.id}>
                            {retrying === request.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                          </Button>
                        )}
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" disabled={deleting === request.id}>
                              {deleting === request.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Analysis Request</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently delete this analysis request, its files, and results. This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDelete(request.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </main>

      <CreateAnalysisModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => refetch()}
      />
    </div>
  );
}
