import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AppHeader } from "@/components/AppHeader";
import { AnalysisSection } from "@/components/analysis/AnalysisSection";
import { useHeapIdentify } from "@/hooks/useHeapIdentify";
import { ArrowLeft, Loader2, ShieldAlert } from "lucide-react";
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

export default function AnalysisRequestDetail() {
  const { requestId } = useParams<{ requestId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  useHeapIdentify();

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
  });

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
              <Badge variant="outline" className={statusColors[request.status] || ""}>
                {statusLabels[request.status] || request.status}
              </Badge>
            </div>

            {request.error_message && (
              <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
                <p className="text-sm font-medium text-destructive">Error</p>
                <p className="text-sm text-destructive/80 mt-1">{request.error_message}</p>
              </div>
            )}

            {/* Analysis Section */}
            {files && files.length > 0 && (
              <AnalysisSection
                requestId={requestId!}
                files={files}
                projectId={request.project_id}
                sourceType={request.source_type}
              />
            )}
          </div>
        )}
      </main>
    </div>
  );
}
