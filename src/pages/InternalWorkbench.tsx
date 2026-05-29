import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AppHeader } from "@/components/AppHeader";
import { useHeapIdentify } from "@/hooks/useHeapIdentify";
import { Eye, Trash2, Loader2, ShieldAlert } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { format } from "date-fns";
import { getUserFriendlyError } from "@/lib/errorHandling";

interface WorkbenchProject {
  id: string;
  name: string;
  user_id: string;
  created_at: string;
  account_type: "standard" | "wmsv";
  creator_name: string;
  creator_email: string;
  file_count: number;
  total_size_bytes: number | null;
  status: string | null;
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
  awaiting_upload: "Awaiting Upload",
  pending: "Importing",
  copying: "Importing",
  copied: "Ready",
  started: "Started",
  processing: "In Progress",
  complete: "Complete",
  failed: "Failed",
};

const formatBytes = (bytes: number | null): string => {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

export default function InternalWorkbench() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  useHeapIdentify();
  const [deleteTarget, setDeleteTarget] = useState<WorkbenchProject | null>(null);
  const [confirmName, setConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);

  const isInternal = user?.email?.toLowerCase().endsWith("@riskclock.com") ?? false;

  useEffect(() => {
    if (user && !isInternal) {
      navigate("/projects", { replace: true });
    }
  }, [user, isInternal, navigate]);

  const { data: projects, isLoading, refetch } = useQuery({
    queryKey: ["workbench-projects"],
    enabled: !!user && isInternal,
    queryFn: async (): Promise<WorkbenchProject[]> => {
      const { data: projectsData, error } = await supabase
        .from("projects")
        .select("id, name, user_id, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;

      const ids = (projectsData || []).map((p) => p.id);
      const userIds = [...new Set((projectsData || []).map((p) => p.user_id))];

      const [profilesRes, analysisRes, emailsRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("user_id, display_name, account_type")
          .in("user_id", userIds),
        ids.length > 0
          ? supabase
              .from("analysis_requests")
              .select("project_id, status, file_count, total_size_bytes, created_at")
              .in("project_id", ids)
              .order("created_at", { ascending: false })
          : Promise.resolve({ data: [] as any[] }),
        supabase.functions
          .invoke(`get-user-emails?userIds=${userIds.join(",")}`, { method: "GET" })
          .catch(() => ({ data: null as any })),
      ]);

      const profilesMap = new Map(
        (profilesRes.data || []).map((p: any) => [p.user_id, p])
      );
      const emailsMap = new Map<string, string>(
        emailsRes.data?.emails ? Object.entries(emailsRes.data.emails) : []
      );
      const latestAnalysis = new Map<string, any>();
      for (const row of (analysisRes.data || []) as any[]) {
        if (!latestAnalysis.has(row.project_id)) latestAnalysis.set(row.project_id, row);
      }

      return (projectsData || []).map((p: any) => {
        const prof: any = profilesMap.get(p.user_id);
        const email = emailsMap.get(p.user_id) || "";
        const analysis = latestAnalysis.get(p.id);
        return {
          id: p.id,
          name: p.name,
          user_id: p.user_id,
          created_at: p.created_at,
          account_type: (prof?.account_type as any) || "standard",
          creator_name: prof?.display_name || (email ? email.split("@")[0] : "Unknown"),
          creator_email: email,
          file_count: analysis?.file_count ?? 0,
          total_size_bytes: analysis?.total_size_bytes ?? null,
          status: analysis?.status ?? null,
        };
      });
    },
  });

  const handleView = (p: WorkbenchProject) => {
    navigate(p.account_type === "wmsv" ? `/wmsv-project/${p.id}` : `/project/${p.id}`);
  };

  const openDelete = (p: WorkbenchProject) => {
    setDeleteTarget(p);
    setConfirmName("");
  };

  const closeDelete = () => {
    if (deleting) return;
    setDeleteTarget(null);
    setConfirmName("");
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    if (confirmName.trim() !== deleteTarget.name) return;
    setDeleting(true);
    try {
      const { data, error } = await supabase
        .from("projects")
        .delete()
        .eq("id", deleteTarget.id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error("Delete affected 0 rows — you may not have permission to delete this project.");
      }
      toast({ title: "Project deleted", description: `"${deleteTarget.name}" was removed.` });
      setDeleteTarget(null);
      setConfirmName("");
      refetch();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error deleting project",
        description: getUserFriendlyError(error),
      });
    } finally {
      setDeleting(false);
    }
  };

  const canConfirm = useMemo(
    () => !!deleteTarget && confirmName.trim() === deleteTarget.name,
    [deleteTarget, confirmName]
  );

  if (!user || !isInternal) {
    return (
      <div className="h-screen flex flex-col bg-background overflow-hidden">
        <AppHeader />
        <main className="container mx-auto px-6 py-12 flex-1 overflow-auto">
          <div className="flex items-center gap-2 text-muted-foreground">
            <ShieldAlert className="h-4 w-4" /> Internal users only.
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <AppHeader />
      <main className="container mx-auto px-6 py-8 flex-1 overflow-auto">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Workbench</h1>
            <p className="text-sm text-muted-foreground mt-1">
              All projects across every user. Internal access only.
            </p>
          </div>
          {projects && (
            <Badge variant="outline" className="text-sm">
              {projects.length} project{projects.length === 1 ? "" : "s"}
            </Badge>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading projects…
          </div>
        ) : !projects || projects.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">No projects yet.</div>
        ) : (
          <div className="bg-card rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project Name</TableHead>
                  <TableHead>Created By</TableHead>
                  <TableHead>Created On</TableHead>
                  <TableHead className="text-right">Files</TableHead>
                  <TableHead className="text-right">Total Size</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right w-[140px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projects.map((p) => {
                  const label = p.status ? statusLabels[p.status] || p.status : "New";
                  const colorClass = p.status ? statusColors[p.status] || "" : "";
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="text-sm">{p.creator_name}</span>
                          {p.creator_email && (
                            <span className="text-xs text-muted-foreground">{p.creator_email}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {format(new Date(p.created_at), "MMM d, yyyy")}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{p.file_count || 0}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatBytes(p.total_size_bytes)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-xs ${colorClass}`}>
                          {label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleView(p)}
                            title="Open project"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openDelete(p)}
                            title="Delete project"
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
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

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && closeDelete()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes <strong>{deleteTarget?.name}</strong> and all of its data.
              This cannot be undone.
              <br />
              <br />
              Type <span className="font-mono font-semibold">{deleteTarget?.name}</span> below to
              confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            placeholder="Project name"
            autoFocus
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
              disabled={!canConfirm || deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
