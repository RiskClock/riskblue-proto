import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AppHeader } from "@/components/AppHeader";
import { useHeapIdentify } from "@/hooks/useHeapIdentify";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Eye,
  Filter,
  Loader2,
  ShieldAlert,
  Trash2,
} from "lucide-react";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  pipeline_phase: string | null;
  error_message: string | null;
  pipeline_progress_done: number | null;
  pipeline_progress_total: number | null;
  request_updated_at: string | null;
  analysis_request_id: string | null;
}

const phaseToOverride: Record<string, "split" | "extract" | "triage" | "analyze" | "summarize"> = {
  splitting: "split",
  extracting: "extract",
  triaging: "triage",
  dispatching_analyze: "analyze",
  analyzing: "analyze",
  summarizing: "summarize",
};

const phaseLabels: Record<string, string> = {
  splitting: "Splitting PDFs",
  extracting: "Extracting Context",
  triaging: "Triaging",
  dispatching_analyze: "Dispatching Analysis",
  analyzing: "Analyzing",
  summarizing: "Summarizing",
};

const formatRelative = (iso: string | null): string => {
  if (!iso) return "—";
  const diffMs = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diffMs / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};


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

type SortKey =
  | "name"
  | "creator"
  | "created_at"
  | "file_count"
  | "total_size_bytes"
  | "status";
type SortDir = "asc" | "desc";

export default function InternalWorkbench() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  useHeapIdentify();
  const [deleteTarget, setDeleteTarget] = useState<WorkbenchProject | null>(null);
  const [confirmName, setConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [resumingId, setResumingId] = useState<string | null>(null);

  const STORAGE_KEY = "workbench-filter";

  const saved = (() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw) as { creators?: string[]; statuses?: string[] };
    } catch {}
    return null;
  })();

  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [filterCreators, setFilterCreators] = useState<string[]>(saved?.creators ?? []);
  const [filterStatuses, setFilterStatuses] = useState<string[]>(saved?.statuses ?? []);

  const isInternal = user?.email?.toLowerCase().endsWith("@riskclock.com") ?? false;

  useEffect(() => {
    if (user && !isInternal) {
      navigate("/projects", { replace: true });
    }
  }, [user, isInternal, navigate]);

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ creators: filterCreators, statuses: filterStatuses }),
    );
  }, [filterCreators, filterStatuses]);

  const { data: projects, isLoading, refetch } = useQuery({
    queryKey: ["workbench-projects"],
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
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
              .select("id, project_id, status, file_count, total_size_bytes, created_at, pipeline_phase, error_message, pipeline_progress_done, pipeline_progress_total, updated_at")
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
          pipeline_phase: analysis?.pipeline_phase ?? null,
          error_message: analysis?.error_message ?? null,
          pipeline_progress_done: analysis?.pipeline_progress_done ?? null,
          pipeline_progress_total: analysis?.pipeline_progress_total ?? null,
          request_updated_at: analysis?.updated_at ?? null,
          analysis_request_id: analysis?.id ?? null,
        };
      });

    },
  });

  const creatorOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of projects || []) {
      const key = p.creator_email || p.creator_name;
      if (!seen.has(key)) {
        seen.set(
          key,
          p.creator_email
            ? `${p.creator_name} (${p.creator_email})`
            : p.creator_name,
        );
      }
    }
    return Array.from(seen.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [projects]);

  const statusOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const p of projects || []) {
      if (p.status) seen.add(p.status);
    }
    return Array.from(seen)
      .map((s) => ({ value: s, label: statusLabels[s] || s }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [projects]);

  const filteredSorted = useMemo(() => {
    let rows = projects || [];
    if (filterCreators.length > 0) {
      rows = rows.filter((p) =>
        filterCreators.includes(p.creator_email || p.creator_name),
      );
    }
    if (filterStatuses.length > 0) {
      rows = rows.filter((p) => p.status && filterStatuses.includes(p.status));
    }
    const out = rows.slice();
    out.sort((a, b) => {
      let va: string | number = "";
      let vb: string | number = "";
      switch (sortKey) {
        case "name":
          va = a.name.toLowerCase();
          vb = b.name.toLowerCase();
          break;
        case "creator":
          va = a.creator_name.toLowerCase();
          vb = b.creator_name.toLowerCase();
          break;
        case "created_at":
          va = new Date(a.created_at).getTime();
          vb = new Date(b.created_at).getTime();
          break;
        case "file_count":
          va = a.file_count || 0;
          vb = b.file_count || 0;
          break;
        case "total_size_bytes":
          va = a.total_size_bytes ?? -1;
          vb = b.total_size_bytes ?? -1;
          break;
        case "status":
          va = (a.status && statusLabels[a.status]) || a.status || "";
          vb = (b.status && statusLabels[b.status]) || b.status || "";
          break;
      }
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return out;
  }, [projects, filterCreators, filterStatuses, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(
        key === "created_at" || key === "file_count" || key === "total_size_bytes"
          ? "desc"
          : "asc",
      );
    }
  };

  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey !== k ? (
      <ArrowUpDown className="h-3 w-3 ml-1 inline opacity-50" />
    ) : sortDir === "asc" ? (
      <ArrowUp className="h-3 w-3 ml-1 inline" />
    ) : (
      <ArrowDown className="h-3 w-3 ml-1 inline" />
    );

  const filterCount =
    (filterCreators.length > 0 ? 1 : 0) + (filterStatuses.length > 0 ? 1 : 0);

  const handleView = (p: WorkbenchProject) => {
    navigate(`/project/${p.id}`);
  };

  const handleResume = async (p: WorkbenchProject) => {
    if (!p.analysis_request_id) return;
    const phaseKey = p.pipeline_phase ?? "";
    const phaseOverride = phaseToOverride[phaseKey] ?? "split";
    setResumingId(p.analysis_request_id);
    try {
      // Clear the failed status + error so the UI immediately reflects the retry.
      await supabase
        .from("analysis_requests")
        .update({
          status: "processing",
          error_message: null,
          pipeline_stop_requested: false,
        })
        .eq("id", p.analysis_request_id);

      const body: Record<string, unknown> = {
        analysisRequestId: p.analysis_request_id,
        phaseOverride,
      };
      if (phaseOverride === "extract") body.resumeExtract = true;

      const { error } = await supabase.functions.invoke("run-analysis-pipeline", {
        body,
      });
      if (error) throw error;
      toast({ title: "Resumed", description: `Re-enqueued ${phaseLabels[phaseKey] || phaseOverride}.` });
      refetch();
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Resume failed",
        description: getUserFriendlyError(err),
      });
    } finally {
      setResumingId(null);
    }
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
        <div className="mb-6 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Risk Identification Workbench</h1>
            <p className="text-sm text-muted-foreground mt-1">
              All projects across every user. Internal access only.
            </p>
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline">
                <Filter className="h-4 w-4 mr-2" />
                Filter
                {filterCount > 0 && (
                  <Badge variant="secondary" className="ml-2 px-1.5">
                    {filterCount}
                  </Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 space-y-4">
              <div>
                <Label className="text-xs uppercase text-muted-foreground">
                  Created By
                </Label>
                <ChecklistGroup
                  options={creatorOptions}
                  selected={filterCreators}
                  onChange={setFilterCreators}
                  emptyLabel="No creators"
                />
              </div>
              <div>
                <Label className="text-xs uppercase text-muted-foreground">
                  Status
                </Label>
                <ChecklistGroup
                  options={statusOptions}
                  selected={filterStatuses}
                  onChange={setFilterStatuses}
                  emptyLabel="No statuses"
                />
              </div>
            </PopoverContent>
          </Popover>
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
                  <TableHead
                    className="cursor-pointer select-none"
                    onClick={() => toggleSort("name")}
                  >
                    Project Name <SortIcon k="name" />
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none"
                    onClick={() => toggleSort("creator")}
                  >
                    Created By <SortIcon k="creator" />
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none"
                    onClick={() => toggleSort("created_at")}
                  >
                    Created On <SortIcon k="created_at" />
                  </TableHead>
                  <TableHead
                    className="text-right cursor-pointer select-none"
                    onClick={() => toggleSort("file_count")}
                  >
                    Files <SortIcon k="file_count" />
                  </TableHead>
                  <TableHead
                    className="text-right cursor-pointer select-none"
                    onClick={() => toggleSort("total_size_bytes")}
                  >
                    Total Size <SortIcon k="total_size_bytes" />
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none"
                    onClick={() => toggleSort("status")}
                  >
                    Status <SortIcon k="status" />
                  </TableHead>
                  <TableHead className="text-right w-[140px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSorted.map((p) => {
                  const baseLabel = p.status ? statusLabels[p.status] || p.status : "New";
                  const label =
                    p.status === "processing" && p.pipeline_phase && phaseLabels[p.pipeline_phase]
                      ? phaseLabels[p.pipeline_phase].split(" ")[0] // e.g. "Splitting", "Extracting"
                      : baseLabel;
                  const colorClass = p.status ? statusColors[p.status] || "" : "";

                  return (
                    <TableRow
                      key={p.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => navigate(`/internal/workbench/project/${p.id}`)}
                    >
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell>
                        <TooltipProvider delayDuration={200}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-sm cursor-default">{p.creator_name}</span>
                            </TooltipTrigger>
                            {p.creator_email && (
                              <TooltipContent>
                                <p>{p.creator_email}</p>
                              </TooltipContent>
                            )}
                          </Tooltip>
                        </TooltipProvider>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {format(new Date(p.created_at), "MMM d, yyyy")}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{p.file_count || 0}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatBytes(p.total_size_bytes)}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        {(p.status === "failed" || p.status === "processing" || p.error_message) ? (
                          <Popover>
                            <PopoverTrigger asChild>
                              <button
                                type="button"
                                className="inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs hover:opacity-80 transition-opacity"
                                style={{}}
                              >
                                <Badge variant="outline" className={`text-xs ${colorClass} border-0 px-0 py-0`}>
                                  {label}
                                </Badge>
                                <span className="h-1.5 w-1.5 rounded-full bg-current opacity-50" />
                              </button>
                            </PopoverTrigger>
                            <PopoverContent align="start" className="w-80 text-sm">
                              <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <span className="font-semibold">Status</span>
                                  <Badge variant="outline" className={`text-xs ${colorClass}`}>{label}</Badge>
                                </div>
                                {p.pipeline_phase && (
                                  <div className="flex justify-between text-xs">
                                    <span className="text-muted-foreground">Phase</span>
                                    <span className="font-medium">{phaseLabels[p.pipeline_phase] || p.pipeline_phase}</span>
                                  </div>
                                )}
                                {p.pipeline_progress_total != null && p.pipeline_progress_total > 0 && (
                                  <div className="flex justify-between text-xs">
                                    <span className="text-muted-foreground">Progress</span>
                                    <span className="font-medium tabular-nums">
                                      {p.pipeline_progress_done ?? 0} / {p.pipeline_progress_total}
                                    </span>
                                  </div>
                                )}
                                <div className="flex justify-between text-xs">
                                  <span className="text-muted-foreground">Last activity</span>
                                  <span className="font-medium">{formatRelative(p.request_updated_at)}</span>
                                </div>
                                {p.error_message && (
                                  <div className="space-y-1">
                                    <div className="text-xs text-muted-foreground">Error</div>
                                    <pre className="text-[11px] whitespace-pre-wrap break-words rounded bg-muted p-2 max-h-40 overflow-auto">
                                      {p.error_message}
                                    </pre>
                                  </div>
                                )}
                                <div className="pt-2 border-t space-y-2">
                                  {p.status === "failed" && p.analysis_request_id && (
                                    <Button
                                      size="sm"
                                      variant="default"
                                      className="w-full"
                                      disabled={resumingId === p.analysis_request_id}
                                      onClick={() => handleResume(p)}
                                    >
                                      {resumingId === p.analysis_request_id ? (
                                        <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Resuming…</>
                                      ) : (
                                        "Resume"
                                      )}
                                    </Button>
                                  )}
                                  <Button
                                    size="sm"
                                    variant={p.status === "failed" ? "outline" : "default"}
                                    className="w-full"
                                    onClick={() => navigate(`/internal/workbench/project/${p.id}`)}
                                  >
                                    Open Project
                                  </Button>
                                </div>
                              </div>
                            </PopoverContent>
                          </Popover>
                        ) : (
                          <Badge variant="outline" className={`text-xs ${colorClass}`}>
                            {label}
                          </Badge>
                        )}
                      </TableCell>

                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
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

// ---------------------------------------------------------------------------
// ChecklistGroup — compact multi-select used in the Filter popover.
// ---------------------------------------------------------------------------
function ChecklistGroup({
  options,
  selected,
  onChange,
  emptyLabel,
}: {
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (v: string[]) => void;
  emptyLabel: string;
}) {
  const allChecked = options.length > 0 && selected.length === options.length;
  const toggle = (value: string) => {
    if (selected.includes(value)) onChange(selected.filter((v) => v !== value));
    else onChange([...selected, value]);
  };
  return (
    <div className="mt-2 rounded-md border">
      <div className="px-2 py-1.5 border-b flex items-center justify-between">
        <button
          type="button"
          className="text-xs text-primary hover:underline disabled:opacity-50"
          onClick={() =>
            onChange(allChecked ? [] : options.map((o) => o.value))
          }
          disabled={options.length === 0}
        >
          {allChecked ? "Uncheck all" : "Check all"}
        </button>
        {selected.length > 0 && (
          <button
            type="button"
            className="text-xs text-muted-foreground hover:underline"
            onClick={() => onChange([])}
          >
            Clear
          </button>
        )}
      </div>
      <div className="max-h-56 overflow-y-auto py-1">
        {options.length === 0 ? (
          <div className="px-3 py-2 text-sm text-muted-foreground">
            {emptyLabel}
          </div>
        ) : (
          options.map((o) => {
            const checked = selected.includes(o.value);
            return (
              <label
                key={o.value}
                className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-muted/50"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={() => toggle(o.value)}
                />
                <span className="truncate">{o.label}</span>
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}
