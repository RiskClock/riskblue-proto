import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Loader2,
  MoreVertical,
  Settings2,
  ShieldAlert,
  Square,
  Trash2,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FileViewerModal } from "@/components/wizard/FileViewerModal";
import {
  prewarmDocumentSource,
  type DocumentSourceDescriptor,
} from "@/components/viewer/hooks/useDocumentSource";
import { useAWPOptions, groupAWPOptionsByCategory } from "@/hooks/useAWPOptions";
import { getUserFriendlyError } from "@/lib/errorHandling";

const PREF_ID = "global";

interface FileRow {
  id: string;
  name: string;
  source_type: string;
  extracted_text: string | null;
  storage_path: string | null;
  mime_type: string | null;
}

interface SheetRow {
  id: string;
  parent_file_id: string;
  page_index: number;
  sheet_number: string | null;
  sheet_title: string | null;
  storage_path: string | null;
  extract_status: string | null;
  extracted_text: string | null;
  file_name: string;
  file_source_type: string;
}

interface TriageCount {
  sheet_id: string | null;
  file_id: string;
  awp_class_name: string;
  instances: number | null;
  score: number | null;
  status: string | null;
}

interface OverrideRow {
  file_id: string;
  awp_class_name: string;
  override_type: "include" | "exclude";
}

function bucketForSource(sourceType: string) {
  return sourceType === "manual_upload" ? "uploaded-drawings" : "drive-analysis-files";
}

export default function WorkbenchProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isInternal = user?.email?.toLowerCase().endsWith("@riskclock.com") ?? false;

  const [activeSheet, setActiveSheet] = useState<SheetRow | null>(null);
  const [activeFile, setActiveFile] = useState<FileRow | null>(null);
  const [preselectClass, setPreselectClass] = useState<string | null>(null);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [cleanupChecked, setCleanupChecked] = useState<Set<string>>(new Set());
  const [cleanupRunning, setCleanupRunning] = useState(false);

  
  const [manageOpen, setManageOpen] = useState(false);
  const [draftCols, setDraftCols] = useState<string[]>([]);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [textFileId, setTextFileId] = useState<string | null>(null);
  const [textSheet, setTextSheet] = useState<{ id: string; label: string } | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [running, setRunning] = useState<"extract" | "triage" | "analyze" | null>(null);
  const [promptClass, setPromptClass] = useState<string | null>(null);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  // Persist sidebar expand/collapse state across modal open/close cycles
  // (but not across browser refresh).
  const [sidebarExpandedClasses, setSidebarExpandedClasses] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);

  const toggleExpand = (fileId: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  };




  useEffect(() => {
    if (user && !isInternal) navigate("/projects", { replace: true });
  }, [user, isInternal, navigate]);

  // Project metadata
  const { data: project } = useQuery({
    queryKey: ["workbench-project", projectId],
    enabled: !!projectId && isInternal,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, name, user_id")
        .eq("id", projectId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Latest analysis_request for this project
  const { data: analysisRequest, isLoading: isLoadingAnalysisRequest } = useQuery({
    queryKey: ["workbench-analysis-request", projectId],
    enabled: !!projectId && isInternal,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("analysis_requests")
        .select("id, source_type, pipeline_phase, status, pipeline_progress_done, pipeline_progress_total")
        .eq("project_id", projectId!)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    refetchInterval: 3000,
  });

  const requestId = analysisRequest?.id;

  // Files + sheets for the latest request
  const { data: rows, isLoading } = useQuery({
    queryKey: ["workbench-rows", requestId],
    enabled: !!requestId,
    queryFn: async () => {
      const [filesRes, sheetsRes] = await Promise.all([
        supabase
          .from("analysis_request_files")
          .select("id, name, extracted_text, storage_path, mime_type")
          .eq("analysis_request_id", requestId!)
          .order("name"),
        supabase
          .from("analysis_request_sheets")
          .select(
            "id, parent_file_id, page_index, sheet_number, sheet_title, storage_path, extract_status, extracted_text",
          )
          .eq("analysis_request_id", requestId!)
          .order("page_index", { ascending: true }),
      ]);
      if (filesRes.error) throw filesRes.error;
      if (sheetsRes.error) throw sheetsRes.error;
      const files: FileRow[] = (filesRes.data || []).map((f: any) => ({
        id: f.id,
        name: f.name,
        source_type: analysisRequest!.source_type,
        extracted_text: f.extracted_text ?? null,
        storage_path: f.storage_path ?? null,
        mime_type: f.mime_type ?? null,
      }));
      const fileMap = new Map(files.map((f) => [f.id, f]));
      const sheets: SheetRow[] = (sheetsRes.data || [])
        .map((s: any): SheetRow | null => {
          const f = fileMap.get(s.parent_file_id);
          if (!f) return null;
          return {
            id: s.id,
            parent_file_id: s.parent_file_id,
            page_index: s.page_index,
            sheet_number: s.sheet_number,
            sheet_title: s.sheet_title,
            storage_path: s.storage_path,
            extract_status: s.extract_status ?? null,
            extracted_text: s.extracted_text ?? null,
            file_name: f.name,
            file_source_type: f.source_type,
          };
        })
        .filter((s): s is SheetRow => s !== null)
        .sort(
          (a, b) =>
            a.file_name.localeCompare(b.file_name) || a.page_index - b.page_index,
        );
      return { files, sheets };
    },
    refetchInterval: 3000,
  });

  // Group: every file is a group, with optional sheets underneath
  const fileGroups = useMemo(() => {
    if (!rows) return [];
    const byFile = new Map<string, { file: FileRow; sheets: SheetRow[] }>();
    for (const f of rows.files) byFile.set(f.id, { file: f, sheets: [] });
    for (const s of rows.sheets) {
      const g = byFile.get(s.parent_file_id);
      if (g) g.sheets.push(s);
    }
    return Array.from(byFile.values()).sort((a, b) =>
      a.file.name.localeCompare(b.file.name),
    );
  }, [rows]);

  // Auto-trigger split phase if files exist with zero sheets and the
  // pipeline isn't currently running. Ensures all PDF pages appear as rows
  // immediately on opening the project detail page.
  const autoSplitInvokedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!requestId || !rows) return;
    if (rows.files.length === 0) return;
    if (rows.sheets.length > 0) return;
    if (analysisRequest?.pipeline_phase) return; // already running
    if (autoSplitInvokedRef.current.has(requestId)) return;
    autoSplitInvokedRef.current.add(requestId);
    supabase.functions
      .invoke("run-analysis-pipeline", {
        body: { analysisRequestId: requestId, phaseOverride: "split" },
      })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ["workbench-rows", requestId] });
        queryClient.invalidateQueries({
          queryKey: ["workbench-analysis-request", projectId],
        });
      })
      .catch((e) => {
        console.error("[workbench] auto-split failed", e);
      });
  }, [requestId, rows, analysisRequest?.pipeline_phase, queryClient, projectId]);

  // Prewarm PDFs into the shared cache so opening the viewer is instant.
  useEffect(() => {
    if (!rows?.sheets?.length) return;
    let cancelled = false;
    const queue = rows.sheets
      .filter((s) => s.storage_path)
      .map<DocumentSourceDescriptor>((s) => ({
        kind: "supabase-storage",
        bucket: bucketForSource(s.file_source_type),
        path: s.storage_path!,
        mimeType: "application/pdf",
      }));
    const CONCURRENCY = 8;
    let idx = 0;
    const worker = async () => {
      while (!cancelled && idx < queue.length) {
        const d = queue[idx++];
        await prewarmDocumentSource(d);
      }
    };
    Promise.all(Array.from({ length: CONCURRENCY }, worker)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [rows]);

  // Triage counts per (sheet, awp_class) and per (file, awp_class)
  const { data: triage } = useQuery({
    queryKey: ["workbench-triage", requestId],
    enabled: !!requestId,
    queryFn: async (): Promise<TriageCount[]> => {
      const { data, error } = await supabase
        .from("analysis_triage_results")
        .select("sheet_id, file_id, awp_class_name, instances, score, status")
        .eq("analysis_request_id", requestId!);
      if (error) throw error;
      return (data || []) as TriageCount[];
    },
    refetchInterval: 3000,
  });

  // Per-sheet analyze status (one row per sheet × awp class)
  const { data: analyzeRows } = useQuery({
    queryKey: ["workbench-analyze", requestId],
    enabled: !!requestId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("analysis_results")
        .select("sheet_id, awp_class_name, status")
        .eq("analysis_request_id", requestId!);
      if (error) throw error;
      return (data || []) as { sheet_id: string | null; awp_class_name: string; status: string }[];
    },
    refetchInterval: 3000,
  });

  // In-flight pipeline jobs — used to show per-cell spinners during triage
  // (and later analyze) without waiting for the final results row to land.
  const { data: pipelineJobs } = useQuery({
    queryKey: ["workbench-jobs", requestId],
    enabled: !!requestId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("analysis_pipeline_jobs")
        .select("sheet_id, awp_class_name, status, job_kind")
        .eq("analysis_request_id", requestId!)
        .in("status", ["pending", "processing"]);
      if (error) throw error;
      return (data || []) as {
        sheet_id: string | null;
        awp_class_name: string | null;
        status: string;
        job_kind: string;
      }[];
    },
    refetchInterval: 2000,
  });



  // Workbench-only overrides
  const { data: overrides } = useQuery({
    queryKey: ["workbench-overrides", requestId],
    enabled: !!requestId,
    queryFn: async (): Promise<OverrideRow[]> => {
      const { data, error } = await supabase
        .from("workbench_triage_overrides" as any)
        .select("file_id, awp_class_name, override_type")
        .eq("analysis_request_id", requestId!);
      if (error) throw error;
      return ((data as unknown) as OverrideRow[]) || [];
    },
  });

  // User-placed drawing instances (per file × class). Refreshed when modal mutates.
  const { data: instanceRows } = useQuery({
    queryKey: ["workbench-instances", requestId],
    enabled: !!requestId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("drawing_instances" as any)
        .select("file_id, awp_class_name, page_index")
        .eq("analysis_request_id", requestId!);
      if (error) throw error;
      return ((data as unknown) as { file_id: string; awp_class_name: string; page_index: number }[]) || [];
    },
  });

  const instanceCountLookup = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of instanceRows || []) {
      const k = `${r.file_id}::${r.awp_class_name}`;
      m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  }, [instanceRows]);

  // Per-page instance count: key = `${fileId}::${pageIndex}::${className}`
  const pageInstanceCountLookup = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of instanceRows || []) {
      const k = `${r.file_id}::${r.page_index}::${r.awp_class_name}`;
      m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  }, [instanceRows]);

  const overrideMap = useMemo(() => {
    const m = new Map<string, "include" | "exclude">();
    for (const o of overrides || []) m.set(`${o.file_id}::${o.awp_class_name}`, o.override_type);
    return m;
  }, [overrides]);

  // AWP options + global column preferences
  const { data: awpOptions } = useAWPOptions();
  const eligibleOptions = useMemo(
    () =>
      (awpOptions || []).filter(
        (o) => o.category === "Asset" || o.category === "Water System",
      ),
    [awpOptions],
  );
  const optionByName = useMemo(() => {
    const m = new Map<string, { name: string; idPrefix: string | null }>();
    for (const o of awpOptions || [])
      m.set(o.name, { name: o.name, idPrefix: o.idPrefix });
    return m;
  }, [awpOptions]);

  // Column preferences are scoped per project. Legacy rows used id='global';
  // each project now persists its own row keyed by projectId.
  const prefId = projectId || PREF_ID;
  const { data: prefs } = useQuery({
    queryKey: ["workbench-column-prefs", prefId],
    enabled: isInternal && !!prefId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workbench_column_preferences")
        .select("awp_class_names")
        .eq("id", prefId)
        .maybeSingle();
      if (error) throw error;
      return (data?.awp_class_names as string[]) || [];
    },
  });

  const enabledCols = prefs || [];


  // (sheet, class) -> { score, status } for triage cell rendering on sub-rows

  const sheetTriageLookup = useMemo(() => {
    const m = new Map<string, { score: number | null; status: string | null }>();
    for (const t of triage || []) {
      if (!t.sheet_id) continue;
      m.set(`${t.sheet_id}::${t.awp_class_name}`, {
        score: t.score,
        status: t.status,
      });
    }
    return m;
  }, [triage]);

  // (sheet, class) -> analyze status for per-sheet analyze badge derivation
  const sheetAnalyzeLookup = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of analyzeRows || []) {
      if (!a.sheet_id) continue;
      m.set(`${a.sheet_id}::${a.awp_class_name}`, a.status);
    }
    return m;
  }, [analyzeRows]);

  // In-flight job sets used to show per-cell spinners.
  const triageInflight = useMemo(() => {
    const s = new Set<string>();
    for (const j of pipelineJobs || []) {
      if (j.job_kind !== "triage" || !j.sheet_id || !j.awp_class_name) continue;
      s.add(`${j.sheet_id}::${j.awp_class_name}`);
    }
    return s;
  }, [pipelineJobs]);
  const analyzeInflight = useMemo(() => {
    const s = new Set<string>();
    for (const j of pipelineJobs || []) {
      if (j.job_kind !== "analyze" || !j.sheet_id || !j.awp_class_name) continue;
      s.add(`${j.sheet_id}::${j.awp_class_name}`);
    }
    return s;
  }, [pipelineJobs]);

  const fileCountLookup = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of triage || []) {
      const key = `${t.file_id}::${t.awp_class_name}`;
      m.set(key, (m.get(key) || 0) + (t.instances || 0));
    }
    return m;
  }, [triage]);

  // (file, class) -> max triage score across sheets, for file-level bg coloring.
  const fileScoreLookup = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of triage || []) {
      if (typeof t.score !== "number") continue;
      const key = `${t.file_id}::${t.awp_class_name}`;
      const prev = m.get(key);
      if (prev == null || t.score > prev) m.set(key, t.score);
    }
    return m;
  }, [triage]);

  // Set of enabled class names for filtering count rollups (only count what's visible).
  const enabledColSet = useMemo(() => new Set(enabledCols), [enabledCols]);

  // Total annotations per file across classes (triage + user/analysis instances).
  // Only counts classes that are currently enabled as columns.
  const fileTotalLookup = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of triage || []) {
      if (!enabledColSet.has(t.awp_class_name)) continue;
      m.set(t.file_id, (m.get(t.file_id) || 0) + (t.instances || 0));
    }
    for (const r of instanceRows || []) {
      if (!enabledColSet.has(r.awp_class_name)) continue;
      m.set(r.file_id, (m.get(r.file_id) || 0) + 1);
    }
    return m;
  }, [triage, instanceRows, enabledColSet]);

  // Total annotations per page (sheet) — triage + user/analysis instances.
  // Key = `${parentFileId}::${pageIndex}` and `sheet:${sheetId}` for triage.
  // Only counts classes that are currently enabled as columns.
  const pageTotalLookup = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of triage || []) {
      if (!t.sheet_id) continue;
      if (!enabledColSet.has(t.awp_class_name)) continue;
      const key = `sheet:${t.sheet_id}`;
      m.set(key, (m.get(key) || 0) + (t.instances || 0));
    }
    for (const r of instanceRows || []) {
      if (!enabledColSet.has(r.awp_class_name)) continue;
      const key = `${r.file_id}::${r.page_index}`;
      m.set(key, (m.get(key) || 0) + 1);
    }
    return m;
  }, [triage, instanceRows, enabledColSet]);


  // Per-file extract status: processed if extracted_text on file OR all sheets extracted/skipped
  const fileExtractStatus = useMemo(() => {
    const m = new Map<string, "processed" | "partial" | "none">();
    for (const g of fileGroups) {
      if (g.file.extracted_text && g.file.extracted_text.length > 0) {
        m.set(g.file.id, "processed");
        continue;
      }
      if (g.sheets.length === 0) {
        m.set(g.file.id, "none");
        continue;
      }
      const total = g.sheets.length;
      const done = g.sheets.filter(
        (s) => s.extract_status === "extracted" || s.extract_status === "skipped",
      ).length;
      if (done === total) m.set(g.file.id, "processed");
      else if (done > 0) m.set(g.file.id, "partial");
      else m.set(g.file.id, "none");
    }
    return m;
  }, [fileGroups]);

  const totalFiles = fileGroups.length;
  const anyFileProcessed = useMemo(
    () => [...fileExtractStatus.values()].some((s) => s === "processed"),
    [fileExtractStatus],
  );

  const openManage = () => {
    setDraftCols(enabledCols);
    setManageOpen(true);
  };

  const toggleDraft = (name: string) => {
    setDraftCols((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  };

  const saveColumns = async () => {
    setSavingPrefs(true);
    try {
      const { error } = await supabase.from("workbench_column_preferences").upsert({
        id: prefId,
        awp_class_names: draftCols,
        updated_at: new Date().toISOString(),
        updated_by: user?.id ?? null,
      });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["workbench-column-prefs", prefId] });
      setManageOpen(false);

    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Could not save columns",
        description: getUserFriendlyError(error),
      });
    } finally {
      setSavingPrefs(false);
    }
  };

  const sheetSource = useMemo<DocumentSourceDescriptor | null>(() => {
    if (!activeSheet || !activeSheet.storage_path) return null;
    return {
      kind: "supabase-storage",
      bucket: bucketForSource(activeSheet.file_source_type),
      path: activeSheet.storage_path,
      mimeType: "application/pdf",
    };
  }, [activeSheet]);

  const fileSource = useMemo<DocumentSourceDescriptor | null>(() => {
    if (!activeFile || !activeFile.storage_path) return null;
    return {
      kind: "supabase-storage",
      bucket: bucketForSource(activeFile.source_type),
      path: activeFile.storage_path,
      mimeType: activeFile.mime_type || "application/pdf",
    };
  }, [activeFile]);

  // --- Pipeline actions -----------------------------------------------------
  const runPipeline = async (
    phase: "extract" | "triage" | "analyze",
    classesOverride?: string[],
  ) => {
    if (!requestId) return;
    setRunning(phase);
    try {
      const body: Record<string, unknown> = {
        analysisRequestId: requestId,
        phaseOverride: phase,
      };
      if (phase === "triage" || phase === "analyze") {
        // Send eligible classes (those visible as columns) so triage actually runs
        const enabledAwpClasses = classesOverride
          ? classesOverride
          : enabledCols.length
            ? enabledCols
            : eligibleOptions.map((o) => o.name);
        body.enabledAwpClasses = enabledAwpClasses;
      }
      const { error } = await supabase.functions.invoke("run-analysis-pipeline", {
        body,
      });
      if (error) throw error;
      if (phase === "triage") toast({ title: "Triage started" });
      else if (phase === "analyze") toast({ title: "Analyze started" });
      queryClient.invalidateQueries({ queryKey: ["workbench-rows", requestId] });
      queryClient.invalidateQueries({ queryKey: ["workbench-triage", requestId] });
      queryClient.invalidateQueries({ queryKey: ["workbench-analyze", requestId] });
      queryClient.invalidateQueries({ queryKey: ["workbench-jobs", requestId] });
      queryClient.invalidateQueries({
        queryKey: ["workbench-analysis-request", projectId],
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Failed to start",
        description: getUserFriendlyError(error),
      });
    } finally {
      // Keep polling for a bit; auto-clear once pipeline phase resolves.
      setTimeout(() => setRunning(null), 30_000);
    }
  };

  const runCleanupIdAssignment = async () => {
    if (!requestId) return;
    const classes = Array.from(cleanupChecked);
    if (classes.length === 0) return;
    setCleanupRunning(true);
    try {
      let totalReassigned = 0;
      for (const cls of classes) {
        const { data, error } = await supabase
          .from("drawing_instances" as any)
          .select("id, instance_number, created_at")
          .eq("analysis_request_id", requestId)
          .eq("awp_class_name", cls)
          .order("instance_number", { ascending: true, nullsFirst: false })
          .order("created_at", { ascending: true });
        if (error) throw error;
        const rows = ((data as unknown) as Array<{ id: string; instance_number: number | null; created_at: string }>) || [];
        // Reassign starting at 1. Skip updates that are already correct.
        for (let i = 0; i < rows.length; i++) {
          const desired = i + 1;
          if (rows[i].instance_number === desired) continue;
          const { error: upErr } = await supabase
            .from("drawing_instances" as any)
            .update({ instance_number: desired })
            .eq("id", rows[i].id);
          if (upErr) throw upErr;
          totalReassigned += 1;
        }
      }
      toast({
        title: "IDs cleaned up",
        description: `Reassigned ${totalReassigned} annotation${totalReassigned === 1 ? "" : "s"} across ${classes.length} class${classes.length === 1 ? "" : "es"}.`,
      });
      queryClient.invalidateQueries({ queryKey: ["workbench-instances", requestId] });
      setCleanupOpen(false);
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "Cleanup failed",
        description: (e as any)?.message || "Could not reassign IDs.",
      });
    } finally {
      setCleanupRunning(false);
    }
  };

  const clearAll = async () => {
    if (!requestId) return;
    setClearing(true);
    try {
      await Promise.all([
        supabase
          .from("analysis_triage_results")
          .delete()
          .eq("analysis_request_id", requestId),
        supabase
          .from("analysis_results")
          .delete()
          .eq("analysis_request_id", requestId),
        supabase
          .from("workbench_triage_overrides" as any)
          .delete()
          .eq("analysis_request_id", requestId),
      ]);
      // Clear extracted text on files + sheets
      await Promise.all([
        supabase
          .from("analysis_request_files")
          .update({ extracted_text: null })
          .eq("analysis_request_id", requestId),
        supabase
          .from("analysis_request_sheets")
          .update({ extracted_text: null, extract_status: "pending" })
          .eq("analysis_request_id", requestId),
      ]);
      await supabase
        .from("analysis_requests")
        .update({
          summary_data: {},
          pipeline_phase: null,
          pipeline_phase_override: null,
        })
        .eq("id", requestId);

      queryClient.invalidateQueries({ queryKey: ["workbench-rows", requestId] });
      queryClient.invalidateQueries({ queryKey: ["workbench-triage", requestId] });
      queryClient.invalidateQueries({ queryKey: ["workbench-overrides", requestId] });
      queryClient.invalidateQueries({
        queryKey: ["workbench-analysis-request", projectId],
      });
      toast({ title: "All results cleared" });
      setClearOpen(false);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Could not clear",
        description: getUserFriendlyError(error),
      });
    } finally {
      setClearing(false);
    }
  };

  // Clear triage + analyze results (and related overrides) for a single class
  // across the current request. Leaves user-placed drawing instances intact.
  const clearClassResults = async (awpClassName: string) => {
    if (!requestId) return;
    try {
      await Promise.all([
        supabase
          .from("analysis_triage_results")
          .delete()
          .eq("analysis_request_id", requestId)
          .eq("awp_class_name", awpClassName),
        supabase
          .from("analysis_results")
          .delete()
          .eq("analysis_request_id", requestId)
          .eq("awp_class_name", awpClassName),
        supabase
          .from("workbench_triage_overrides" as any)
          .delete()
          .eq("analysis_request_id", requestId)
          .eq("awp_class_name", awpClassName),
      ]);
      queryClient.invalidateQueries({ queryKey: ["workbench-triage", requestId] });
      queryClient.invalidateQueries({ queryKey: ["workbench-analyze", requestId] });
      queryClient.invalidateQueries({ queryKey: ["workbench-overrides", requestId] });
      toast({ title: `Cleared results for ${awpClassName}` });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Could not clear class",
        description: getUserFriendlyError(error),
      });
    }
  };

  // --- Export -----------------------------------------------------------------
  const handleExportResults = async () => {
    if (!requestId || exporting) return;
    setExporting(true);
    try {
      const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } =
        await import("docx");

      // Load all annotated instances for this request, scoped to enabled classes.
      const { data: instances, error } = await supabase
        .from("drawing_instances" as any)
        .select("awp_class_name, file_id, page_index, nx, ny, created_at")
        .eq("analysis_request_id", requestId)
        .order("awp_class_name")
        .order("created_at", { ascending: true });
      if (error) throw error;

      const fileNameById = new Map(fileGroups.map((g) => [g.file.id, g.file.name]));
      const prefixOf = (name: string) =>
        optionByName.get(name)?.idPrefix || name.slice(0, 3).toUpperCase();

      // Group by class, then sort by file name + created_at to match viewer numbering.
      const byClass = new Map<string, any[]>();
      for (const i of (instances as any[]) || []) {
        const arr = byClass.get(i.awp_class_name) || [];
        arr.push(i);
        byClass.set(i.awp_class_name, arr);
      }
      const today = new Date();
      const ymd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
      const projectName = project?.name || "Project";

      const children: any[] = [
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun({ text: `RiskBlue Workbench Export — ${projectName}`, bold: true })],
        }),
        new Paragraph({
          children: [
            new TextRun({ text: `Generated: ${today.toLocaleString()}`, italics: true, size: 20 }),
          ],
        }),
        new Paragraph({ children: [new TextRun("")] }),
      ];

      const sortedClassNames = Array.from(byClass.keys()).sort();
      if (sortedClassNames.length === 0) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: "No annotated instances found.", italics: true })],
          }),
        );
      }
      for (const className of sortedClassNames) {
        const arr = (byClass.get(className) || []).slice().sort((a, b) => {
          const an = fileNameById.get(a.file_id) || "";
          const bn = fileNameById.get(b.file_id) || "";
          return an.localeCompare(bn) || a.created_at.localeCompare(b.created_at);
        });
        const prefix = prefixOf(className);
        children.push(
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            children: [
              new TextRun({ text: `${className} (${arr.length})`, bold: true }),
            ],
          }),
        );
        arr.forEach((inst, idx) => {
          const id = `${prefix}-${String(idx + 1).padStart(3, "0")}`;
          const fname = fileNameById.get(inst.file_id) || "Unknown file";
          children.push(
            new Paragraph({
              children: [
                new TextRun({ text: id, bold: true }),
                new TextRun({ text: `  ·  ${fname}  ·  Page ${inst.page_index}` }),
              ],
            }),
          );
        });
        children.push(new Paragraph({ children: [new TextRun("")] }));
      }

      const doc = new Document({
        creator: "RiskBlue",
        title: `RiskBlue Workbench Export - ${projectName}`,
        sections: [{ children }],
      });

      const blob = await Packer.toBlob(doc);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `RiskBlue Workbench Export ${ymd} - ${projectName}.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: "Export ready", description: "Your .docx has been downloaded." });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Export failed",
        description: getUserFriendlyError(error),
      });
    } finally {
      setExporting(false);
    }
  };


  // --- Triage cell click ----------------------------------------------------
  const toggleOverride = async (
    fileId: string,
    awpClassName: string,
    aggregateCount: number,
  ) => {
    if (!requestId) return;
    const key = `${fileId}::${awpClassName}`;
    const current = overrideMap.get(key);
    try {
      if (current) {
        await supabase
          .from("workbench_triage_overrides" as any)
          .delete()
          .eq("analysis_request_id", requestId)
          .eq("file_id", fileId)
          .eq("awp_class_name", awpClassName);
      } else {
        const newType = aggregateCount > 0 ? "exclude" : "include";
        await supabase.from("workbench_triage_overrides" as any).upsert(
          {
            analysis_request_id: requestId,
            file_id: fileId,
            awp_class_name: awpClassName,
            override_type: newType,
            created_by: user?.id ?? null,
          } as any,
          { onConflict: "analysis_request_id,file_id,awp_class_name" },
        );
      }
      queryClient.invalidateQueries({ queryKey: ["workbench-overrides", requestId] });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Could not update",
        description: getUserFriendlyError(error),
      });
    }
  };

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

  const grouped = awpOptions ? groupAWPOptionsByCategory(eligibleOptions) : {};

  const stickyHeadFirst = "sticky left-0 z-30 bg-card min-w-[260px] max-w-[420px] w-[420px] border-r";
  const stickyCellFirstBase = "sticky left-0 z-10 border-r transition-colors max-w-[420px] w-[420px]";

  // Derive the currently-active phase from DB (authoritative) with `running`
  // as a short-lived optimistic fallback while the row hasn't updated yet.
  const dbPhase = analysisRequest?.pipeline_phase ?? null;
  const dbStatus = analysisRequest?.status ?? null;
  const activePhase: "extract" | "triage" | "analyze" | null =
    dbPhase === "extracting"
      ? "extract"
      : dbPhase === "triaging"
        ? "triage"
        : dbPhase === "analyzing" || dbPhase === "summarizing" || dbPhase === "dispatching_analyze"
          ? "analyze"
          : running;
  const phaseRunning = !!activePhase;
  const hasTriageRun = (triage?.length ?? 0) > 0;

  const stopPipeline = async () => {
    if (!requestId) return;
    try {
      await supabase.functions.invoke("run-analysis-pipeline", {
        body: { analysisRequestId: requestId, action: "stop" },
      });
      setRunning(null);
      queryClient.invalidateQueries({ queryKey: ["workbench-analysis-request", projectId] });
      queryClient.invalidateQueries({ queryKey: ["workbench-rows", requestId] });
      queryClient.invalidateQueries({ queryKey: ["workbench-triage", requestId] });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Failed to stop",
        description: getUserFriendlyError(error),
      });
    }
  };

  return (
    <TooltipProvider delayDuration={150}>
      <div className="h-screen flex flex-col bg-background overflow-hidden">
        <AppHeader />

        {/* Sub-header (no longer sticky) */}
        <div className="border-b bg-background">
          <div className="container mx-auto px-6 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => navigate("/internal/workbench")}
                aria-label="Back to Workbench"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <h1 className="text-xl font-bold text-foreground truncate">
                {project?.name || "Project"}
              </h1>
            </div>
            {activePhase && (
              <Badge variant="outline" className="text-xs capitalize">
                {dbPhase || activePhase}
              </Badge>
            )}
          </div>
        </div>

        <main className="flex-1 overflow-auto">
          <div className="container mx-auto px-6 py-6 space-y-4">
            {/* Action toolbar */}
            <div className="flex flex-wrap items-center gap-2">
              {activePhase === "extract" ? (
                <Button size="sm" variant="destructive" onClick={stopPipeline}>
                  <Square className="h-3.5 w-3.5 mr-1.5" /> Stop Extracting Context
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => runPipeline("extract")}
                  disabled={!requestId || phaseRunning || totalFiles === 0}
                >
                  Extract Context
                </Button>
              )}
              {activePhase === "triage" ? (
                <Button size="sm" variant="destructive" onClick={stopPipeline}>
                  <Square className="h-3.5 w-3.5 mr-1.5" /> Stop Triaging
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => runPipeline("triage")}
                  disabled={!requestId || phaseRunning || totalFiles === 0}
                >
                  Triage
                </Button>
              )}
              {activePhase === "analyze" ? (
                <Button size="sm" variant="destructive" onClick={stopPipeline}>
                  <Square className="h-3.5 w-3.5 mr-1.5" /> Stop Analyzing
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => runPipeline("analyze")}
                  disabled={!requestId || phaseRunning || totalFiles === 0}
                >
                  Analyze
                </Button>
              )}

              <span className="text-muted-foreground select-none">|</span>

              <Button
                size="sm"
                variant="outline"
                onClick={() => setClearOpen(true)}
                disabled={!requestId || phaseRunning}
              >
                <Trash2 className="h-4 w-4 mr-1.5" />
                Clear All
              </Button>

              <div className="flex-1" />

              {analysisRequest && totalFiles > 0 && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      toast({
                        title: "Export queued",
                        description: "You'll receive an email with the results.",
                      })
                    }
                    disabled={!requestId}
                  >
                    Export Results
                  </Button>
                  <Button
                    size="sm"
                    onClick={() =>
                      toast({
                        title: "Sent to WMG Project",
                        description: "Results have been sent.",
                      })
                    }
                    disabled={!requestId}
                  >
                    Send to WMG Project
                  </Button>
                </>
              )}
            </div>

            {isLoadingAnalysisRequest || (analysisRequest && isLoading) ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
              </div>
            ) : !analysisRequest || totalFiles === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                No drawings uploaded for this project yet.
              </div>
            ) : (
              <div className="bg-card rounded-lg border overflow-hidden relative max-h-[calc(100vh-220px)] [&>div]:max-h-[calc(100vh-220px)]">
                <Table>
                  <TableHeader className="sticky top-0 z-20 bg-card">
                    <TableRow>
                      <TableHead className={`${stickyHeadFirst} h-9 py-1`}>
                        Files ({totalFiles} file{totalFiles === 1 ? "" : "s"})
                      </TableHead>
                      {enabledCols.map((name) => {
                        const opt = optionByName.get(name);
                        const label = opt?.idPrefix || name;
                        const classHasTriage = (triage || []).some(
                          (t) => t.awp_class_name === name,
                        );
                        return (
                          <TableHead
                            key={name}
                            className="text-center whitespace-nowrap h-9 py-1"
                          >
                            <div className="inline-flex items-center gap-1">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    className="font-semibold hover:underline underline-offset-2"
                                    onClick={() => setPromptClass(name)}
                                  >
                                    {label}
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent>{name} — click to view prompt</TooltipContent>
                              </Tooltip>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <button
                                    type="button"
                                    className="text-muted-foreground hover:text-foreground p-0.5 rounded hover:bg-muted/50"
                                    aria-label={`Actions for ${name}`}
                                  >
                                    <MoreVertical className="h-3.5 w-3.5" />
                                  </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem
                                    disabled={!anyFileProcessed || phaseRunning}
                                    onClick={() => runPipeline("triage", [name])}
                                  >
                                    {classHasTriage ? "Re-Triage" : "Triage"}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    disabled={!anyFileProcessed || !classHasTriage || phaseRunning}
                                    onClick={() => runPipeline("analyze", [name])}
                                  >
                                    Analyze
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    disabled={phaseRunning}
                                    onClick={() => clearClassResults(name)}
                                  >
                                    Clear
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </TableHead>
                        );
                      })}

                      <TableHead className="text-right w-[1%] whitespace-nowrap h-9 py-1">
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={openManage}
                          disabled={phaseRunning}
                          aria-label="Manage columns"
                          title="Manage columns"
                          className="h-8 w-8"
                        >
                          <Settings2 className="h-4 w-4" />
                        </Button>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fileGroups.map((group) => {
                      const singlePage = group.sheets.length <= 1;
                      const onlySheet = group.sheets[0];
                      const extractStatus = fileExtractStatus.get(group.file.id);
                      const isProcessing =
                        activePhase === "extract" && extractStatus !== "processed";

                      const StatusBadge = () => {
                        if (extractStatus === "processed") {
                          return (
                            <Badge
                              variant="outline"
                              onClick={(e) => {
                                e.stopPropagation();
                                setTextFileId(group.file.id);
                              }}
                              className="ml-auto shrink-0 h-4 px-1.5 text-[10px] leading-none bg-emerald-500/10 text-emerald-700 border-emerald-500/30 cursor-pointer hover:bg-emerald-500/20"
                            >
                              Processed
                            </Badge>
                          );
                        }
                        if (isProcessing || extractStatus === "partial") {
                          return (
                            <Badge variant="outline" className="ml-auto shrink-0 h-4 px-1.5 text-[10px] leading-none gap-1">
                              <Loader2 className="h-2.5 w-2.5 animate-spin" />
                              Processing
                            </Badge>
                          );
                        }
                        return null;
                      };


                      const renderTriageCell = (
                        fileId: string,
                        awpClassName: string,
                        count: number,
                        scoreKnown: boolean,
                        score?: number,
                      ) => {
                        const key = `${fileId}::${awpClassName}`;
                        const override = overrideMap.get(key);
                        const clickable = hasTriageRun;
                        const hasScore = typeof score === "number";
                        const opacity = hasScore ? Math.max(0, Math.min(100, score!)) / 100 : 0;
                        // Show count ONLY when user/analysis instances exist.
                        // Triage results contribute bg color only, no number.
                        const inner =
                          count > 0 ? (
                            <span className="font-medium tabular-nums">{count}</span>
                          ) : (
                            <span className="text-muted-foreground">
                              {scoreKnown ? "" : "—"}
                            </span>
                          );
                        const title = !clickable
                          ? undefined
                          : override === "include"
                            ? "Manually included — click to clear"
                            : override === "exclude"
                              ? "Manually excluded — click to clear"
                              : hasScore
                                ? `Triage: ${score}%${count > 0 ? ` · ${count}` : ""} — click to ${count > 0 ? "exclude" : "include"}`
                                : count > 0
                                  ? "Click to exclude"
                                  : "Click to include";
                        return (
                          <TableCell
                            key={awpClassName}
                            title={title}
                            className={`text-center py-1 relative group ${
                              clickable ? "cursor-pointer" : ""
                            } ${
                              override === "exclude"
                                ? "bg-muted/60"
                                : override === "include"
                                  ? "bg-emerald-500/20"
                                  : clickable
                                    ? "hover:bg-muted/40"
                                    : ""
                            }`}
                            style={
                              hasScore && override !== "exclude" && override !== "include"
                                ? { backgroundColor: `rgba(16, 185, 129, ${opacity * 0.55})` }
                                : undefined
                            }
                            onClick={(e) => {
                              if (!clickable) return;
                              e.stopPropagation();
                              toggleOverride(fileId, awpClassName, count);
                            }}
                          >
                            <span className="inline-flex items-center justify-center w-full">
                              {override === "exclude" ? (
                                <span className="line-through text-muted-foreground">
                                  {count > 0 ? count : "—"}
                                </span>
                              ) : (
                                inner
                              )}
                            </span>
                          </TableCell>
                        );
                      };

                      // Per-sheet extract state — drives the per-page Processing/Processed badge.
                      const sheetExtractState = (s: SheetRow): "done" | "running" | "failed" | "pending" => {
                        const st = s.extract_status;
                        if (st === "extracted" || st === "skipped") return "done";
                        if (st === "extracting") return "running";
                        if (st === "failed") return "failed";
                        return "pending";
                      };

                      const SheetStatusBadge = ({ s }: { s: SheetRow }) => {
                        const st = sheetExtractState(s);
                        if (st === "done") {
                          const label = `Page ${s.page_index}${s.sheet_number ? ` · ${s.sheet_number}` : ""}`;
                          return (
                            <Badge
                              variant="outline"
                              onClick={(e) => {
                                e.stopPropagation();
                                setTextSheet({ id: s.id, label: `${group.file.name} — ${label}` });
                              }}
                              className="ml-auto shrink-0 h-4 px-1.5 text-[10px] leading-none bg-emerald-500/10 text-emerald-700 border-emerald-500/30 cursor-pointer hover:bg-emerald-500/20"
                            >
                              Processed
                            </Badge>
                          );
                        }
                        if (st === "running" || (activePhase === "extract" && st !== "failed")) {
                          return (
                            <Badge
                              variant="outline"
                              className="ml-auto shrink-0 h-4 px-1.5 text-[10px] leading-none gap-1"
                            >
                              <Loader2 className="h-2.5 w-2.5 animate-spin" />
                              Processing
                            </Badge>
                          );
                        }
                        if (st === "failed") {
                          return (
                            <Badge
                              variant="outline"
                              className="ml-auto shrink-0 h-4 px-1.5 text-[10px] leading-none bg-red-500/10 text-red-700 border-red-500/30"
                            >
                              Failed
                            </Badge>
                          );
                        }
                        return null;
                      };

                      const isExpanded = expandedFiles.has(group.file.id);

                      return (
                        <Fragment key={group.file.id}>
                          {/* File-level row */}
                          <TableRow
                            className="group h-8 cursor-pointer"
                            onClick={() => {
                              if (singlePage && onlySheet) setActiveSheet(onlySheet);
                              else toggleExpand(group.file.id);
                            }}
                          >
                            <TableCell
                              className={`${stickyCellFirstBase} bg-card group-hover:bg-muted/50 py-1 text-sm`}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                {!singlePage ? (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggleExpand(group.file.id);
                                    }}
                                    className="shrink-0 text-muted-foreground hover:text-foreground"
                                    aria-label={isExpanded ? "Collapse pages" : "Expand pages"}
                                  >
                                    {isExpanded ? (
                                      <ChevronDown className="h-3.5 w-3.5" />
                                    ) : (
                                      <ChevronRight className="h-3.5 w-3.5" />
                                    )}
                                  </button>
                                ) : (
                                  <span className="inline-block w-3.5 shrink-0" />
                                )}
                                <span className="font-medium truncate min-w-0">
                                  {group.file.name}
                                  {(() => {
                                    const n = fileTotalLookup.get(group.file.id) || 0;
                                    return n > 0 ? ` (${n} ${n === 1 ? "instance" : "instances"})` : "";
                                  })()}
                                </span>
                                {!singlePage && (
                                  <span className="text-xs text-muted-foreground shrink-0">
                                    {group.sheets.length} pages
                                  </span>
                                )}
                                <StatusBadge />
                              </div>
                            </TableCell>
                            {enabledCols.map((name) => {
                              const baseCount =
                                fileCountLookup.get(`${group.file.id}::${name}`) || 0;
                              const userCount =
                                instanceCountLookup.get(`${group.file.id}::${name}`) || 0;
                              // Annotation count is independent of triage score — show both.
                              const count = baseCount + userCount;
                              const fileScore = fileScoreLookup.get(`${group.file.id}::${name}`);
                              const scoreKnown =
                                fileScore != null ||
                                (triage || []).some(
                                  (t) =>
                                    t.file_id === group.file.id && t.awp_class_name === name,
                                ) ||
                                userCount > 0 ||
                                baseCount > 0;
                              return renderTriageCell(group.file.id, name, count, scoreKnown, fileScore);
                            })}
                            <TableCell className="py-1" />
                          </TableRow>

                          {/* Per-page sub-rows (only when multi-page AND expanded) */}
                          {!singlePage && isExpanded &&
                            group.sheets.map((s) => (
                              <TableRow
                                key={s.id}
                                className="group h-8 cursor-pointer bg-muted/10"
                                onClick={() => setActiveSheet(s)}
                              >
                                <TableCell
                                  className={`${stickyCellFirstBase} bg-muted/10 group-hover:bg-muted/30 py-1 text-sm`}
                                >
                                  <div className="flex items-center gap-2 min-w-0 pl-7">
                                    <span className="text-muted-foreground truncate min-w-0">
                                      Page {s.page_index}
                                      {s.sheet_number ? ` · ${s.sheet_number}` : ""}
                                      {s.sheet_title ? ` — ${s.sheet_title}` : ""}
                                      {(() => {
                                        const n =
                                          (pageTotalLookup.get(`sheet:${s.id}`) || 0) +
                                          (pageTotalLookup.get(`${s.parent_file_id}::${s.page_index}`) || 0);
                                        return n > 0 ? ` (${n} ${n === 1 ? "instance" : "instances"})` : "";
                                      })()}
                                    </span>
                                    <SheetStatusBadge s={s} />
                                  </div>
                                </TableCell>
                                {enabledCols.map((name) => {
                                  const tr = sheetTriageLookup.get(`${s.id}::${name}`);
                                  const score = tr?.score;
                                  const failed = tr?.status === "failed";
                                  const hasScore = typeof score === "number";
                                  const inflight = triageInflight.has(`${s.id}::${name}`);
                                  const userCount =
                                    pageInstanceCountLookup.get(
                                      `${s.parent_file_id}::${s.page_index}::${name}`,
                                    ) || 0;
                                  const triageInstances =
                                    (triage || []).find(
                                      (t) => t.sheet_id === s.id && t.awp_class_name === name,
                                    )?.instances ?? 0;
                                  // Annotation count is independent of triage score — show both.
                                  const totalCount = triageInstances + userCount;
                                  const opacity = hasScore ? Math.max(0, Math.min(100, score!)) / 100 : 0;
                                  const title = failed
                                    ? "Triage failed"
                                    : hasScore
                                      ? `Triage: ${score}%${totalCount > 0 ? ` · ${totalCount} annotation${totalCount === 1 ? "" : "s"}` : ""}`
                                      : inflight
                                        ? "Triaging…"
                                        : totalCount > 0
                                          ? `${totalCount} annotation${totalCount === 1 ? "" : "s"}`
                                          : "Not triaged";
                                  return (
                                    <TableCell
                                      key={name}
                                      title={title}
                                      className="text-center py-1 text-xs relative p-0 cursor-pointer hover:bg-muted/30"
                                      style={
                                        hasScore && !failed
                                          ? { backgroundColor: `rgba(16, 185, 129, ${opacity * 0.55})` }
                                          : undefined
                                      }
                                      onClick={() => {
                                        // Bubbles up to row click which opens
                                        // the viewer; we just record which
                                        // class column was clicked so the
                                        // modal preselects the right radio.
                                        setPreselectClass(name);
                                      }}
                                    >
                                      <div className="flex items-center justify-center w-full h-7">
                                        {inflight && !hasScore && !failed ? (
                                          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                                        ) : failed ? (
                                          <span className="text-red-600">!</span>
                                        ) : totalCount > 0 ? (
                                          <span className="font-medium tabular-nums">{totalCount}</span>
                                        ) : (
                                          <span className="text-muted-foreground">
                                            {hasScore ? "" : "—"}
                                          </span>
                                        )}
                                      </div>
                                    </TableCell>
                                  );
                                })}
                                <TableCell className="py-1" />
                              </TableRow>
                            ))}
                        </Fragment>
                      );

                    })}
                  </TableBody>
                </Table>
              </div>
            )}

            {enabledCols.length > 0 && (
              <div className="flex justify-end mt-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setCleanupChecked(new Set());
                    setCleanupOpen(true);
                  }}
                >
                  Clean Up ID Assignment
                </Button>
              </div>
            )}

          </div>
        </main>

        {/* Drawing modal — single sheet */}
        {activeSheet && sheetSource && (
          <FileViewerModal
            isOpen={!!activeSheet}
            onClose={() => { setActiveSheet(null); setPreselectClass(null); }}
            fileId={activeSheet.id}
            fileName={
              fileGroups.find((g) => g.file.id === activeSheet.parent_file_id)?.sheets
                .length === 1
                ? activeSheet.file_name
                : `${activeSheet.file_name} — Page ${activeSheet.page_index}`
            }
            mimeType="application/pdf"
            accessToken=""
            detections={[]}
            sourceOverride={sheetSource}
            analysisRequestId={requestId}
            parentFileId={activeSheet.parent_file_id}
            sheetId={activeSheet.id}
            pageIndex={activeSheet.page_index}
            awpClasses={enabledCols.map((name) => ({
              name,
              prefix: optionByName.get(name)?.idPrefix ?? null,
              analysisCount:
                fileCountLookup.get(`${activeSheet.parent_file_id}::${name}`) || 0,
            }))}
            fileNameById={Object.fromEntries(
              fileGroups.map((g) => [g.file.id, g.file.name]),
            )}
            onInstancesChanged={() => {
              queryClient.invalidateQueries({
                queryKey: ["workbench-instances", requestId],
              });
            }}
            persistKey={projectId}
            expandedClasses={sidebarExpandedClasses}
            onExpandedClassesChange={setSidebarExpandedClasses}
            preselectClass={preselectClass}
          />
        )}

        {/* Parent file modal — full multi-page PDF with page navigation */}
        {activeFile && fileSource && (
          <FileViewerModal
            isOpen={!!activeFile}
            onClose={() => { setActiveFile(null); setPreselectClass(null); }}
            fileId={activeFile.id}
            fileName={activeFile.name}
            mimeType={activeFile.mime_type || "application/pdf"}
            accessToken=""
            detections={[]}
            sourceOverride={fileSource}
            analysisRequestId={requestId}
            parentFileId={activeFile.id}
            sheetId={null}
            pageIndex={1}
            awpClasses={enabledCols.map((name) => ({
              name,
              prefix: optionByName.get(name)?.idPrefix ?? null,
              analysisCount:
                fileCountLookup.get(`${activeFile.id}::${name}`) || 0,
            }))}
            fileNameById={Object.fromEntries(
              fileGroups.map((g) => [g.file.id, g.file.name]),
            )}
            onInstancesChanged={() => {
              queryClient.invalidateQueries({
                queryKey: ["workbench-instances", requestId],
              });
            }}
            persistKey={projectId}
            expandedClasses={sidebarExpandedClasses}
            onExpandedClassesChange={setSidebarExpandedClasses}
            preselectClass={preselectClass}
          />
        )}

        {/* AWP class prompt modal */}
        <AwpPromptModal
          className={promptClass}
          onClose={() => setPromptClass(null)}
        />


        {/* Extracted-text modal */}
        <Dialog
          open={!!textFileId || !!textSheet}
          onOpenChange={(o) => {
            if (!o) {
              setTextFileId(null);
              setTextSheet(null);
            }
          }}
        >
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Extracted text</DialogTitle>
              <DialogDescription>
                {textSheet
                  ? textSheet.label
                  : fileGroups.find((g) => g.file.id === textFileId)?.file.name}
              </DialogDescription>
            </DialogHeader>
            {(textFileId || textSheet) && (
              <ExtractedTextBody
                fileId={textFileId ?? undefined}
                sheetId={textSheet?.id}
              />
            )}
          </DialogContent>
        </Dialog>

        {/* Manage columns modal */}
        <Dialog open={manageOpen} onOpenChange={setManageOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Manage columns</DialogTitle>
              <DialogDescription>
                Pick which assets and water systems appear as columns. Shared across
                all internal users.
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[60vh] overflow-auto space-y-5 py-2">
              {Object.entries(grouped).map(([category, opts]) => (
                <div key={category}>
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                    {category}
                  </div>
                  <div className="space-y-2">
                    {opts.map((opt) => {
                      const checked = draftCols.includes(opt.name);
                      return (
                        <label
                          key={opt.id}
                          className="flex items-center gap-2 text-sm cursor-pointer"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => toggleDraft(opt.name)}
                          />
                          <span>
                            {opt.idPrefix ? (
                              <>
                                <span className="font-mono text-xs text-muted-foreground mr-2">
                                  {opt.idPrefix}
                                </span>
                                {opt.name}
                              </>
                            ) : (
                              opt.name
                            )}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setManageOpen(false)}
                disabled={savingPrefs}
              >
                Cancel
              </Button>
              <Button onClick={saveColumns} disabled={savingPrefs}>
                {savingPrefs ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Clear All confirmation */}
        <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Clear all results?</AlertDialogTitle>
              <AlertDialogDescription>
                This deletes extracted text, triage results, analysis results, and
                Workbench overrides for this project's latest analysis request. The
                files themselves are not removed.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={clearing}>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={clearAll} disabled={clearing}>
                {clearing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Clear All"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
}

// ---------------------------------------------------------------------------
// AwpPromptModal — shows prompt content + opens source Google Doc
// ---------------------------------------------------------------------------
function AwpPromptModal({
  className,
  onClose,
}: {
  className: string | null;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"triage" | "analyze">("triage");
  const [row, setRow] = useState<{
    prompt_content: string | null;
    drive_file_url: string | null;
    drive_file_name: string | null;
    triage_prompt_content: string | null;
    triage_drive_file_url: string | null;
    triage_drive_file_name: string | null;
  } | null>(null);

  useEffect(() => {
    if (!className) {
      setRow(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("awp_class_prompts")
        .select(
          "prompt_content, drive_file_url, drive_file_name, triage_prompt_content, triage_drive_file_url, triage_drive_file_name",
        )
        .eq("awp_class_name", className)
        .maybeSingle();
      if (!cancelled) {
        setRow(
          (data as any) ?? {
            prompt_content: null,
            drive_file_url: null,
            drive_file_name: null,
            triage_prompt_content: null,
            triage_drive_file_url: null,
            triage_drive_file_name: null,
          },
        );
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [className]);

  const isTriage = tab === "triage";
  const content = isTriage ? row?.triage_prompt_content : row?.prompt_content;
  const driveUrl = isTriage ? row?.triage_drive_file_url : row?.drive_file_url;
  const driveName = isTriage ? row?.triage_drive_file_name : row?.drive_file_name;

  return (
    <Dialog open={!!className} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{className}</DialogTitle>
          <DialogDescription>
            {driveName || `Prompt used during ${isTriage ? "triage" : "analysis"}.`}
          </DialogDescription>
        </DialogHeader>
        <div className="inline-flex rounded-md border bg-muted p-0.5 self-start text-xs">
          <button
            type="button"
            onClick={() => setTab("triage")}
            className={`px-3 py-1 rounded ${
              isTriage ? "bg-background shadow-sm" : "text-muted-foreground"
            }`}
          >
            Triage prompt
          </button>
          <button
            type="button"
            onClick={() => setTab("analyze")}
            className={`px-3 py-1 rounded ${
              !isTriage ? "bg-background shadow-sm" : "text-muted-foreground"
            }`}
          >
            Analyze prompt
          </button>
        </div>
        {loading ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="max-h-[55vh] overflow-auto border rounded-md p-4 bg-muted/30">
            <pre className="text-xs whitespace-pre-wrap font-mono text-foreground">
              {content || "(no prompt content)"}
            </pre>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button
            disabled={!driveUrl}
            onClick={() => {
              if (driveUrl) window.open(driveUrl, "_blank");
            }}
          >
            Open Source File
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


// ---------------------------------------------------------------------------
// ExtractedTextBody — shows file extracted text without page line-break headers
// ---------------------------------------------------------------------------
function ExtractedTextBody({ fileId, sheetId }: { fileId?: string; sheetId?: string }) {
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      let combined = "";
      if (sheetId) {
        const { data: sheetRow } = await supabase
          .from("analysis_request_sheets")
          .select("extracted_text")
          .eq("id", sheetId)
          .maybeSingle();
        combined = (sheetRow?.extracted_text as string) || "";
      } else if (fileId) {
        const { data: fileRow } = await supabase
          .from("analysis_request_files")
          .select("extracted_text")
          .eq("id", fileId)
          .maybeSingle();
        combined = (fileRow?.extracted_text as string) || "";
        if (!combined) {
          const { data: sheets } = await supabase
            .from("analysis_request_sheets")
            .select("page_index, extracted_text")
            .eq("parent_file_id", fileId)
            .order("page_index");
          if (sheets && sheets.length > 0) {
            combined = sheets
              .filter((s: any) => s.extracted_text)
              .map((s: any) => s.extracted_text as string)
              .join(" ");
          }
        }
      }
      // Strip line breaks per spec ("without line breaks")
      const flat = (combined || "").replace(/\s+/g, " ").trim();
      if (!cancelled) {
        setText(flat || null);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fileId, sheetId]);

  const handleCopy = () => {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 min-h-0">
      <div className="flex justify-end">
        <button
          onClick={handleCopy}
          disabled={!text}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? "Copied" : "Copy all"}
        </button>
      </div>
      <div className="max-h-[60vh] overflow-auto border rounded-md p-4 bg-muted/30">
        <p className="text-xs font-mono text-foreground whitespace-pre-wrap [overflow-wrap:anywhere] break-words">
          {text || "(no text extracted)"}
        </p>
      </div>
    </div>
  );
}
