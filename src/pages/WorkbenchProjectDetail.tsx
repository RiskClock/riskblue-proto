import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  FileText,
  Loader2,
  MoreVertical,
  Settings2,
  ShieldAlert,
  Square,
  Trash2,
  Upload,
  Bug,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { SpaceEditModal } from "@/components/workbench/SpaceEditModal";
import { ConsolidateRisersModal } from "@/components/workbench/ConsolidateRisersModal";

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
  parseSurveyFloorPlans,
  floorPlanDisplayLabel,
  getAddedUnitPlans,
  addedUnitPlanToParsed,
  makeAddedUnitPlanId,
  ADDED_UNIT_PLANS_KEY,
  DELETED_PLAN_IDS_KEY,
  getDeletedPlanIds,
  type ParsedFloorPlan,
} from "@/lib/surveyFloorPlans";

import { DrawingViewer } from "@/components/viewer";
import {
  prewarmDocumentSource,
  type DocumentSourceDescriptor,
} from "@/components/viewer/hooks/useDocumentSource";
import { useAWPOptions, groupAWPOptionsByCategory } from "@/hooks/useAWPOptions";
import { getUserFriendlyError } from "@/lib/errorHandling";
import { awpClassColor, readableTextOn, softBgFrom } from "@/lib/awpColor";

const PREF_ID = "global";

interface FileRow {
  id: string;
  name: string;
  source_type: string;
  extracted_text: string | null;
  storage_path: string | null;
  mime_type: string | null;
  survey_raw_response?: string | null;
  survey_raw_updated_at?: string | null;
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
  survey_result?: unknown;
  survey_updated_at?: string | null;
}

const SURVEY_PROGRESS_KEY_PREFIX = "riskblue:survey-progress";

function surveyProgressStorageKey(requestId: string) {
  return `${SURVEY_PROGRESS_KEY_PREFIX}:${requestId}`;
}

function formatSurveyContent(result: unknown): string {
  if (result == null) return "";
  if (typeof result === "string") return result;
  if (typeof result === "object") {
    const record = result as Record<string, unknown>;
    const preferred = record.content ?? record.summary ?? record.text;
    if (preferred != null) return typeof preferred === "string" ? preferred : JSON.stringify(preferred, null, 2);
  }
  return JSON.stringify(result, null, 2);
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

/** Format a set of space names for a multi-level badge.
 * Contiguous numeric "Level N" runs collapse to "Level X-Y".
 * Non-contiguous "Level N" sets render as "Level X & Y".
 * Mixed/non-numeric falls back to joining with " & ". */
function formatSpaceBadge(spaces: string[]): string {
  if (spaces.length === 0) return "";
  if (spaces.length === 1) return spaces[0];
  const parsed = spaces.map((s) => {
    const m = /^Level\s+(-?\d+)$/.exec(s);
    return m ? parseInt(m[1], 10) : null;
  });
  if (parsed.every((n) => n !== null)) {
    const nums = (parsed as number[]).slice().sort((a, b) => a - b);
    const contiguous = nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
    if (contiguous) return `Level ${nums[0]}-${nums[nums.length - 1]}`;
    return `Level ${nums.join(" & ")}`;
  }
  return spaces.join(" & ");
}

export default function WorkbenchProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>();
  const { user, session } = useAuth();
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
  // Survey Pages
  const [surveyRunning, setSurveyRunning] = useState(false);
  const [surveyProgress, setSurveyProgress] = useState<{
    current: number;
    total: number;
    fileName: string;
    phase: "uploading" | "querying" | "done";
  } | null>(null);
  const [surveyResults, setSurveyResults] = useState<Array<{
    sheetId: string;
    file: string;
    page: number;
    sheet_number: string | null;
    content: string;
  }>>([]);
  const [surveyRawText, setSurveyRawText] = useState<string>("");
  const [surveyRecoveredRun, setSurveyRecoveredRun] = useState(false);
  const [surveyResponseModal, setSurveyResponseModal] = useState<{ fileName: string; raw: string } | null>(null);
  const [scoutDebugOpen, setScoutDebugOpen] = useState(false);

  const [spaceModalOpen, setSpaceModalOpen] = useState(false);
  const [buildingSpace, setBuildingSpace] = useState(false);
  const [instancesReportOpen, setInstancesReportOpen] = useState(false);
  const [consolidateOpen, setConsolidateOpen] = useState(false);
  const [spaceEditTarget, setSpaceEditTarget] = useState<
    {
      fileName: string;
      pageNumber: number;
      current: string[];
      planId?: string;
      sheetId?: string;
    } | null
  >(null);
  const [identifyRunning, setIdentifyRunning] = useState(false);
  const [uploadingReport, setUploadingReport] = useState(false);
  const reportInputRef = useRef<HTMLInputElement>(null);
  const [downloadingAll, setDownloadingAll] = useState(false);

  // Page Info table (lightweight: just enumerate pages per file, no splitting)
  type PageInfoRow = {
    id: string;
    name: string;
    source_type: string;
    storage_path: string | null;
    mime_type: string | null;
    page_count: number | null;
  };
  const [pageInfoRows, setPageInfoRows] = useState<PageInfoRow[]>([]);
  const [pageInfoLoading, setPageInfoLoading] = useState(false);
  const [pageInfoExpanded, setPageInfoExpanded] = useState<Set<string>>(new Set());
  const [activePageView, setActivePageView] = useState<{ file: PageInfoRow; page: number } | null>(null);

  const togglePageInfoExpand = (fileId: string) => {
    setPageInfoExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId); else next.add(fileId);
      return next;
    });
  };

  const activePageViewSource = useMemo<DocumentSourceDescriptor | null>(() => {
    if (!activePageView || !activePageView.file.storage_path) return null;
    return {
      kind: "supabase-storage",
      bucket: bucketForSource(activePageView.file.source_type),
      path: activePageView.file.storage_path,
      mimeType: activePageView.file.mime_type || "application/pdf",
    };
  }, [activePageView]);

  // ---------------------------------------------------------------
  // Floor-plan data for the activePageView modal (single-page modal)
  // ---------------------------------------------------------------
  const [activeFileSurveyRaw, setActiveFileSurveyRaw] = useState<string | null>(null);
  const [activeSheetIdForPage, setActiveSheetIdForPage] = useState<string | null>(null);
  const [activeFloorPlanOverrides, setActiveFloorPlanOverrides] = useState<
    Record<string, any>
  >({});
  const [activeFileRiskClasses, setActiveFileRiskClasses] = useState<string[]>([]);

  useEffect(() => {
    if (!activePageView) {
      setActiveFileSurveyRaw(null);
      setActiveSheetIdForPage(null);
      setActiveFloorPlanOverrides({});
      setActiveFileRiskClasses([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const fileId = activePageView.file.id;
      const page = activePageView.page;
      const [fileRes, sheetRes] = await Promise.all([
        supabase
          .from("analysis_request_files")
          .select("survey_raw_response, risk_element_results")
          .eq("id", fileId)
          .maybeSingle(),
        supabase
          .from("analysis_request_sheets")
          .select("id, floor_plan_overrides")
          .eq("parent_file_id", fileId)
          .eq("page_index", page)
          .maybeSingle(),
      ]);
      if (cancelled) return;
      setActiveFileSurveyRaw((fileRes.data as any)?.survey_raw_response ?? null);
      const rer = (fileRes.data as any)?.risk_element_results as Record<string, any> | null;
      const classes = rer && typeof rer === "object"
        ? Object.keys(rer).filter((k) => {
            const v = rer[k];
            return v && typeof v === "object" && typeof v.result_text === "string" && v.result_text.length > 0;
          })
        : [];
      setActiveFileRiskClasses(classes);
      setActiveSheetIdForPage((sheetRes.data as any)?.id ?? null);
      const overrides = (sheetRes.data as any)?.floor_plan_overrides;
      setActiveFloorPlanOverrides(
        overrides && typeof overrides === "object" ? overrides : {},
      );
    })();
    return () => { cancelled = true; };
  }, [activePageView]);

  const activeFileFloorPlansByPage = useMemo(
    () => parseSurveyFloorPlans(activeFileSurveyRaw),
    [activeFileSurveyRaw],
  );

  const activePageFloorPlans = useMemo<ParsedFloorPlan[]>(() => {
    if (!activePageView) return [];
    const deleted = getDeletedPlanIds(activeFloorPlanOverrides);
    const base = (activeFileFloorPlansByPage.get(activePageView.page) ?? []).filter(
      (fp) => !deleted.has(fp.plan_id),
    );
    const added = getAddedUnitPlans(activeFloorPlanOverrides, activePageView.page)
      .filter((e) => !deleted.has(e.plan_id))
      .map(addedUnitPlanToParsed);
    return [...base, ...added];
  }, [activeFileFloorPlansByPage, activePageView, activeFloorPlanOverrides]);

  const activeFileAllUnitPlans = useMemo<ParsedFloorPlan[]>(() => {
    const deleted = getDeletedPlanIds(activeFloorPlanOverrides);
    const out: ParsedFloorPlan[] = [];
    for (const plans of activeFileFloorPlansByPage.values()) {
      for (const p of plans) {
        if (p.type === "unit_floor_plan" && !deleted.has(p.plan_id)) out.push(p);
      }
    }
    for (const entry of getAddedUnitPlans(activeFloorPlanOverrides)) {
      if (!deleted.has(entry.plan_id)) out.push(addedUnitPlanToParsed(entry));
    }
    return out;
  }, [activeFileFloorPlansByPage, activeFloorPlanOverrides]);

  const activeFileAllLevelPlans = useMemo<ParsedFloorPlan[]>(() => {
    const deleted = getDeletedPlanIds(activeFloorPlanOverrides);
    const out: ParsedFloorPlan[] = [];
    for (const plans of activeFileFloorPlansByPage.values()) {
      for (const p of plans) {
        if (p.type === "level_floor_plan" && !deleted.has(p.plan_id)) out.push(p);
      }
    }
    return out;
  }, [activeFileFloorPlansByPage, activeFloorPlanOverrides]);


  // className -> planId derived from per-plan `annotations: string[]` overrides.
  const activeAnnotationAssignments = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const [planId, ovr] of Object.entries(activeFloorPlanOverrides)) {
      if (planId.startsWith("__")) continue;
      const anns = (ovr as any)?.annotations;
      if (Array.isArray(anns)) {
        for (const cn of anns) {
          if (typeof cn === "string") out[cn] = planId;
        }
      }
    }
    return out;
  }, [activeFloorPlanOverrides]);


  const saveFloorPlanOverride = async (
    planId: string,
    next: Record<string, any>,
  ) => {
    if (!activeSheetIdForPage) {
      toast({
        variant: "destructive",
        title: "Cannot save",
        description: "No sheet row exists yet for this page.",
      });
      return;
    }
    const merged = {
      ...activeFloorPlanOverrides,
      [planId]: { ...(activeFloorPlanOverrides[planId] ?? {}), ...next },
    };
    setActiveFloorPlanOverrides(merged);
    // Coalesce-safe: we re-write the full object derived from prior fetch
    // (the column has a NOT NULL DEFAULT '{}' so the row is never null).
    const { error } = await supabase
      .from("analysis_request_sheets")
      .update({ floor_plan_overrides: merged } as any)
      .eq("id", activeSheetIdForPage);
    if (error) {
      toast({
        variant: "destructive",
        title: "Could not save floor plan",
        description: getUserFriendlyError(error),
      });
    }
  };

  // Reassign an annotation (AWP class) to a plan on this page, or unassign.
  // We mutate every plan override's `annotations` array so each class belongs
  // to at most one plan on the page.
  const assignAnnotationToPlan = async (
    className: string,
    planId: string | null,
  ) => {
    if (!activeSheetIdForPage) {
      toast({
        variant: "destructive",
        title: "Cannot save",
        description: "No sheet row exists yet for this page.",
      });
      return;
    }
    const next: Record<string, any> = { ...activeFloorPlanOverrides };
    // Strip className from every plan's annotations list.
    for (const [pid, ovr] of Object.entries(next)) {
      if (pid.startsWith("__")) continue;
      const arr = Array.isArray((ovr as any)?.annotations)
        ? ((ovr as any).annotations as string[]).filter((c) => c !== className)
        : [];
      next[pid] = { ...(ovr as any), annotations: arr };
    }
    // Add to the target plan (if any).
    if (planId) {
      const prev = (next[planId] ?? {}) as any;
      const arr = Array.isArray(prev.annotations) ? prev.annotations.slice() : [];
      if (!arr.includes(className)) arr.push(className);
      next[planId] = { ...prev, annotations: arr };
    }
    setActiveFloorPlanOverrides(next);
    const { error } = await supabase
      .from("analysis_request_sheets")
      .update({ floor_plan_overrides: next } as any)
      .eq("id", activeSheetIdForPage);
    if (error) {
      toast({
        variant: "destructive",
        title: "Could not save assignment",
        description: getUserFriendlyError(error),
      });
    }
  };

  // Delete a floor plan entirely. Parsed plans are tombstoned via
  // __deleted_plan_ids; manually-added unit plans are removed from
  // __added_unit_plans. Also clears any per-plan override entry.
  const deleteFloorPlan = async (planId: string) => {
    if (!activeSheetIdForPage) {
      toast({
        variant: "destructive",
        title: "Cannot delete",
        description: "No sheet row exists yet for this page.",
      });
      return;
    }
    const next: Record<string, any> = { ...activeFloorPlanOverrides };
    // Remove per-plan override (assignments, bbox, name).
    if (planId in next) delete next[planId];
    // Remove from added unit plans if it lives there.
    const added = Array.isArray(next[ADDED_UNIT_PLANS_KEY])
      ? (next[ADDED_UNIT_PLANS_KEY] as any[]).filter((e) => e?.plan_id !== planId)
      : [];
    if (added.length > 0) next[ADDED_UNIT_PLANS_KEY] = added;
    else delete next[ADDED_UNIT_PLANS_KEY];
    // Tombstone parsed plans so they vanish from the view.
    const existingDeleted = Array.isArray(next[DELETED_PLAN_IDS_KEY])
      ? (next[DELETED_PLAN_IDS_KEY] as any[]).filter((s) => typeof s === "string")
      : [];
    if (!existingDeleted.includes(planId)) existingDeleted.push(planId);
    next[DELETED_PLAN_IDS_KEY] = existingDeleted;

    setActiveFloorPlanOverrides(next);
    const { error } = await supabase
      .from("analysis_request_sheets")
      .update({ floor_plan_overrides: next } as any)
      .eq("id", activeSheetIdForPage);
    if (error) {
      toast({
        variant: "destructive",
        title: "Could not delete floor plan",
        description: getUserFriendlyError(error),
      });
    }
  };

  // Add a manually-created floor plan (with bounding box) to the current page.
  const addFloorPlan = async (args: {
    type: "level_floor_plan" | "unit_floor_plan";
    name: string;
    bbox_pct: [number, number, number, number];
  }) => {
    if (!activePageView || !activeSheetIdForPage) {
      toast({
        variant: "destructive",
        title: "Cannot add floor plan",
        description: "No sheet row exists yet for this page.",
      });
      return;
    }
    const page = activePageView.page;
    const planId = makeAddedUnitPlanId(args.name || "plan", page);
    const next: Record<string, any> = { ...activeFloorPlanOverrides };
    const existingAdded = Array.isArray(next[ADDED_UNIT_PLANS_KEY])
      ? (next[ADDED_UNIT_PLANS_KEY] as any[])
      : [];
    const entry = {
      plan_id: planId,
      reference_id: args.name,
      page_number: page,
      type: args.type,
      bbox_pct: args.bbox_pct,
      name: args.name,
    };
    next[ADDED_UNIT_PLANS_KEY] = [...existingAdded, entry];
    setActiveFloorPlanOverrides(next);
    const { error } = await supabase
      .from("analysis_request_sheets")
      .update({ floor_plan_overrides: next } as any)
      .eq("id", activeSheetIdForPage);
    if (error) {
      toast({
        variant: "destructive",
        title: "Could not add floor plan",
        description: getUserFriendlyError(error),
      });
    }
  };




  const openFloorEditForPlan = (planId: string, currentFloors: string[]) => {
    if (!activePageView || !activeSheetIdForPage) return;
    setSpaceEditTarget({
      fileName: activePageView.file.name,
      pageNumber: activePageView.page,
      current: currentFloors,
      planId,
      sheetId: activeSheetIdForPage,
    });
  };


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



  // Hydrate survey results from persisted analysis_request_sheets.survey_result
  // so a page refresh doesn't drop the rendered output.
  // Runs whenever rows.sheets change AND we have no in-memory results AND no run in progress.
  const hydratedSurveyKeyRef = useRef<string | null>(null);

  // Project metadata
  const { data: project } = useQuery({
    queryKey: ["workbench-project", projectId],
    enabled: !!projectId && isInternal,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, name, user_id, selected_awp_class_names, selected_other_classes, report_file_path, report_file_name")
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
        .select("id, source_type, pipeline_phase, status, pipeline_progress_done, pipeline_progress_total, space_hierarchy_json, space_hierarchy_status, space_hierarchy_error, space_hierarchy_updated_at")
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

  // Load Page Info: list files, fill missing page counts via pdf.js, cache to DB.
  // source_type lives on analysis_requests, not on analysis_request_files.
  const requestSourceType = (analysisRequest as any)?.source_type as string | undefined;
  useEffect(() => {
    if (!requestId || !requestSourceType) { setPageInfoRows([]); return; }
    let cancelled = false;
    (async () => {
      setPageInfoLoading(true);
      try {
        const { data, error } = await supabase
          .from("analysis_request_files")
          .select("id, name, storage_path, mime_type, expected_page_count")
          .eq("analysis_request_id", requestId)
          .order("name");
        if (error) throw error;
        const initial: PageInfoRow[] = ((data ?? []) as any[]).map((r) => ({
          id: r.id,
          name: r.name,
          source_type: requestSourceType,
          storage_path: r.storage_path,
          mime_type: r.mime_type,
          page_count: r.expected_page_count ?? null,
        }));
        if (cancelled) return;
        setPageInfoRows(initial);

        const missing = initial.filter(
          (r) => r.page_count == null && r.storage_path && (r.mime_type ?? "application/pdf").includes("pdf"),
        );
        if (missing.length === 0) return;
        const pdfjsLib = await import("pdfjs-dist");
        for (const row of missing) {
          if (cancelled) return;
          try {
            const { data: signed, error: signErr } = await supabase.storage
              .from(bucketForSource(row.source_type))
              .createSignedUrl(row.storage_path!, 600);
            if (signErr || !signed?.signedUrl) continue;
            const resp = await fetch(signed.signedUrl);
            const buf = await resp.arrayBuffer();
            const doc = await pdfjsLib.getDocument({ data: buf }).promise;
            const count = doc.numPages;
            try { doc.destroy(); } catch { /* ignore */ }
            if (cancelled) return;
            setPageInfoRows((prev) =>
              prev.map((r) => (r.id === row.id ? { ...r, page_count: count } : r)),
            );
            void supabase
              .from("analysis_request_files")
              .update({ expected_page_count: count })
              .eq("id", row.id);
          } catch (e) {
            console.warn("[page-info] count failed for", row.name, e);
          }
        }
      } catch (e) {
        console.warn("[page-info] load failed", e);
      } finally {
        if (!cancelled) setPageInfoLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [requestId, requestSourceType]);



  // Files + sheets for the latest request
  const { data: rows, isLoading } = useQuery({
    queryKey: ["workbench-rows", requestId],
    enabled: !!requestId,
    queryFn: async () => {
      const [filesRes, sheetsRes] = await Promise.all([
        supabase
          .from("analysis_request_files")
          .select("id, name, extracted_text, storage_path, mime_type, survey_raw_response, survey_raw_updated_at")
          .eq("analysis_request_id", requestId!)
          .order("name"),

        supabase
          .from("analysis_request_sheets")
          .select(
            "id, parent_file_id, page_index, sheet_number, sheet_title, storage_path, extract_status, extracted_text, survey_result, survey_updated_at",
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
        survey_raw_response: f.survey_raw_response ?? null,
        survey_raw_updated_at: f.survey_raw_updated_at ?? null,
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
            survey_result: s.survey_result ?? null,
            survey_updated_at: s.survey_updated_at ?? null,
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

  // Map every file to its parsed floor plans by page number, so the Pages by
  // File table can render per-page badges (floors + reference_id) without
  // hitting the network.
  const floorPlansByFile = useMemo(() => {
    const m = new Map<string, Map<number, ParsedFloorPlan[]>>();
    for (const f of rows?.files ?? []) {
      const raw = (f as any).survey_raw_response as string | null | undefined;
      if (!raw) continue;
      m.set(f.id, parseSurveyFloorPlans(raw));
    }
    return m;
  }, [rows?.files]);

  // Rehydrate survey results from DB after refresh.
  useEffect(() => {
    if (surveyRunning) return;
    if (!rows?.sheets?.length) return;
    const key = `${requestId}:${rows.sheets.length}:${rows.sheets.map((s) => s.survey_updated_at ?? "").join("|")}`;
    if (hydratedSurveyKeyRef.current === key) return;
    if (surveyResults.length > 0) return;
    const persisted = rows.sheets
      .map((s) => {
        const content = formatSurveyContent(s.survey_result);
        if (!content.trim()) return null;
        return {
          sheetId: s.id,
          file: s.file_name,
          page: s.page_index,
          sheet_number: s.sheet_number,
          content,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => a.file.localeCompare(b.file) || a.page - b.page);
    if (persisted.length > 0) {
      setSurveyResults(persisted);
      hydratedSurveyKeyRef.current = key;
    }
    // Hydrate raw response text from persisted file rows.
    if (rows?.files?.length) {
      const rawChunks = rows.files
        .filter((f) => (f.survey_raw_response ?? "").trim().length > 0)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((f) => `===== ${f.name} =====\n${f.survey_raw_response}`);
      if (rawChunks.length > 0) setSurveyRawText(rawChunks.join("\n\n"));
    }

  }, [rows, requestId, surveyRunning, surveyResults.length]);

  useEffect(() => {
    if (!requestId || surveyRunning) return;
    const raw = window.sessionStorage.getItem(surveyProgressStorageKey(requestId));
    if (!raw) return;
    try {
      const saved = JSON.parse(raw);
      if (saved?.total && saved?.current) {
        setSurveyRecoveredRun(true);
        setSurveyProgress({
          current: saved.current,
          total: saved.total,
          fileName: saved.fileName ?? "",
          phase: saved.phase === "uploading" ? "uploading" : "querying",
        });
      }
    } catch {
      window.sessionStorage.removeItem(surveyProgressStorageKey(requestId));
    }
  }, [requestId, surveyRunning]);

  useEffect(() => {
    if (!surveyRunning) return;
    const warnBeforeRefresh = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeRefresh);
    return () => window.removeEventListener("beforeunload", warnBeforeRefresh);
  }, [surveyRunning]);

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

  // Note: auto-split on upload/import was removed. The splitting (and any
  // downstream phases) must be triggered explicitly by the user.


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

  // Persisted multi-space consolidation groups for this analysis request.
  const { data: consolidations } = useQuery({
    queryKey: ["workbench-consolidations", requestId],
    enabled: !!requestId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("annotation_consolidations" as any)
        .select("id, awp_class_name, label, instance_number, member_annotation_ids")
        .eq("analysis_request_id", requestId!);
      if (error) throw error;
      return ((data as unknown) as {
        id: string;
        awp_class_name: string;
        label: string;
        instance_number: number | null;
        member_annotation_ids: string[];
      }[]) || [];
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
    const m = new Map<string, { name: string; idPrefix: string | null; category: string }>();
    for (const o of awpOptions || [])
      m.set(o.name, { name: o.name, idPrefix: o.idPrefix, category: o.category });
    return m;
  }, [awpOptions]);

  // Spannable classes (Configuration > "Can Span Multiple Spaces") that actually
  // have annotations in this analysis request — used to gate the
  // "Consolidate Risers" pre-report step.
  const spannableClassesWithAnnotations = useMemo<
    { name: string; idPrefix: string | null }[]
  >(() => {
    const classNamesWithAnn = new Set((instanceRows || []).map((r) => r.awp_class_name));
    return (awpOptions || [])
      .filter((o) => o.canSpanMultipleSpaces && classNamesWithAnn.has(o.name))
      .map((o) => ({ name: o.name, idPrefix: o.idPrefix }));
  }, [awpOptions, instanceRows]);

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
      // Return null (not []) when no row exists, so we can fall back to the
      // project's original class selection chosen at creation time.
      return data ? ((data.awp_class_names as string[]) || []) : null;
    },
  });

  // Original classes chosen when the project was created (canonical + "other"
  // free-text). Used as the workbench column default before the user customizes.
  const projectSelectedClassNames = useMemo<string[]>(() => {
    const canonical = ((project as any)?.selected_awp_class_names as string[] | null) || [];
    const others = ((project as any)?.selected_other_classes as string[] | null) || [];
    return [...canonical, ...others];
  }, [project]);

  // Custom (user-typed) classes at creation time that are NOT in the canonical
  // AWP options list. These should not become workbench columns automatically,
  // but their presence flags the Manage Columns button so internal users know
  // the project creator entered free-text classes.
  const customClassNames = useMemo<string[]>(() => {
    if (!awpOptions) return [];
    const known = new Set((awpOptions || []).map((o) => o.name));
    const others = ((project as any)?.selected_other_classes as string[] | null) || [];
    const canonical = ((project as any)?.selected_awp_class_names as string[] | null) || [];
    const seen = new Set<string>();
    const result: string[] = [];
    for (const n of [...others, ...canonical]) {
      if (!known.has(n) && !seen.has(n)) {
        seen.add(n);
        result.push(n);
      }
    }
    return result;
  }, [awpOptions, project]);

  // Default columns exclude custom (non-canonical) entries.
  const defaultEnabledCols = useMemo(
    () => projectSelectedClassNames.filter((n) => !customClassNames.includes(n)),
    [projectSelectedClassNames, customClassNames],
  );
  const enabledCols = prefs ?? defaultEnabledCols;

  const hasRisersSelected = useMemo(() => {
    return enabledCols.some((col) => col === "Electrical Riser" || col === "Mechanical Riser");
  }, [enabledCols]);



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

  const handleDownloadAllFiles = async () => {
    if (downloadingAll || fileGroups.length === 0) return;
    setDownloadingAll(true);
    try {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      const usedNames = new Set<string>();
      let added = 0;
      const failures: string[] = [];

      for (const g of fileGroups) {
        const f = g.file;
        if (!f.storage_path) {
          failures.push(f.name);
          continue;
        }
        const bucket = bucketForSource(f.source_type);
        const { data, error } = await supabase.storage.from(bucket).download(f.storage_path);
        if (error || !data) {
          failures.push(f.name);
          continue;
        }
        let name = f.name || "file";
        if (usedNames.has(name)) {
          const dot = name.lastIndexOf(".");
          const base = dot > 0 ? name.slice(0, dot) : name;
          const ext = dot > 0 ? name.slice(dot) : "";
          let i = 2;
          while (usedNames.has(`${base} (${i})${ext}`)) i++;
          name = `${base} (${i})${ext}`;
        }
        usedNames.add(name);
        zip.file(name, await data.arrayBuffer());
        added++;
      }

      if (added === 0) {
        toast({ title: "Download failed", description: "No files could be downloaded.", variant: "destructive" });
        return;
      }

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safeProject = (project?.name || "Project").replace(/[\\/:*?"<>|]/g, "_");
      a.download = `${safeProject} - Drawings.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      toast({
        title: "Download ready",
        description:
          failures.length > 0
            ? `${added} file${added === 1 ? "" : "s"} downloaded; ${failures.length} failed.`
            : `${added} file${added === 1 ? "" : "s"} downloaded.`,
      });
    } catch (e: any) {
      toast({ title: "Download failed", description: (e as any)?.message || "Unknown error", variant: "destructive" });
    } finally {
      setDownloadingAll(false);
    }
  };

  const anyFileProcessed = useMemo(
    () => [...fileExtractStatus.values()].some((s) => s === "processed"),
    [fileExtractStatus],
  );
  const allFilesProcessed = useMemo(
    () =>
      fileGroups.length > 0 &&
      [...fileExtractStatus.values()].every((s) => s === "processed"),
    [fileExtractStatus, fileGroups.length],
  );
  const spaceHierarchyPayload = analysisRequest?.space_hierarchy_json as any | null | undefined;
  const spaceHierarchyResponseId = spaceHierarchyPayload?.openai_response_id as string | undefined;
  const spaceHierarchyHasResult = !!(spaceHierarchyPayload?.parsed || spaceHierarchyPayload?.raw_text);
  const spaceHierarchyRunning =
    buildingSpace ||
    analysisRequest?.space_hierarchy_status === "running";


  // Accept either "physical_spaces" (legacy) or "spatial_records" (current prompt schema).
  const extractSpaces = (parsed: any): any[] => {
    if (!parsed) return [];
    if (Array.isArray(parsed.physical_spaces)) return parsed.physical_spaces;
    if (Array.isArray(parsed.spatial_records)) return parsed.spatial_records;
    return [];
  };

  // Map "fileName::pageNumber" -> [space names], built from parsed hierarchy.
  const pageSpaceMap = useMemo(() => {
    const map = new Map<string, string[]>();
    const spaces = extractSpaces(spaceHierarchyPayload?.parsed);
    for (const sp of spaces) {
      const name = sp?.standardized_space_name;
      if (!name) continue;
      for (const src of sp?.matched_sources || []) {
        const key = `${src?.file_name}::${src?.page_number}`;
        const arr = map.get(key) || [];
        if (!arr.includes(name)) arr.push(name);
        map.set(key, arr);
      }
    }
    return map;
  }, [spaceHierarchyPayload]);

  // Unit-aware page map: "fileName::pageNumber" -> [{level, unit?}, ...].
  // Level entries come from spatial_records.matched_sources (one per page);
  // unit entries come from unit_templates: each page where a unit plan lives
  // is expanded once per level the unit applies to. Falls back to pageSpaceMap
  // for projects whose space_hierarchy_json predates unit_templates.
  const pageSpaceUnitMap = useMemo(() => {
    const map = new Map<string, Array<{ level: string; unit?: string }>>();
    const parsed: any = spaceHierarchyPayload?.parsed;
    const spaces = extractSpaces(parsed);
    for (const sp of spaces) {
      const name = sp?.standardized_space_name;
      if (!name) continue;
      for (const src of sp?.matched_sources || []) {
        const key = `${src?.file_name}::${src?.page_number}`;
        const arr = map.get(key) || [];
        arr.push({ level: name });
        map.set(key, arr);
      }
    }
    const units: any[] = Array.isArray(parsed?.unit_templates) ? parsed.unit_templates : [];
    for (const u of units) {
      const unitName = typeof u?.unit_name === "string" ? u.unit_name : null;
      if (!unitName) continue;
      const levels: string[] = Array.isArray(u?.applies_to_levels) ? u.applies_to_levels.filter((l: any) => typeof l === "string") : [];
      const sources: any[] = Array.isArray(u?.matched_sources) ? u.matched_sources : [];
      for (const src of sources) {
        const key = `${src?.file_name}::${src?.page_number}`;
        const arr = map.get(key) || [];
        // When applies_to_levels is empty, still record the unit so the
        // detection isn't dropped — treat the unit page as its own "space".
        if (levels.length === 0) {
          arr.push({ level: unitName, unit: unitName });
        } else {
          for (const lvl of levels) arr.push({ level: lvl, unit: unitName });
        }
        map.set(key, arr);
      }
    }
    return map;
  }, [spaceHierarchyPayload]);

  const spacesForSheet = (fileName: string, pageIndex: number): string[] => {
    return pageSpaceMap.get(`${fileName}::${pageIndex}`) || [];
  };


  const hierarchyBuilt = extractSpaces(spaceHierarchyPayload?.parsed).length > 0;

  const allSpaceNames = useMemo<string[]>(() => {
    return extractSpaces(spaceHierarchyPayload?.parsed)
      .map((s: any) => s?.standardized_space_name)
      .filter((n): n is string => typeof n === "string" && n.length > 0);
  }, [spaceHierarchyPayload]);

  const openSpaceEdit = (fileName: string, pageNumber: number) => {
    setSpaceEditTarget({
      fileName,
      pageNumber,
      current: spacesForSheet(fileName, pageNumber),
    });
  };

  const handleSaveSpaces = async (newSpaces: string[]) => {
    if (!spaceEditTarget || !analysisRequest?.id) return;
    // Branch: per-plan edit (from FloorPlansPanel) writes to floor_plan_overrides
    // for that single plan and does NOT mutate the page-level space hierarchy.
    if (spaceEditTarget.planId) {
      await saveFloorPlanOverride(spaceEditTarget.planId, { floors: newSpaces });
      setSpaceEditTarget(null);
      return;
    }
    const { fileName, pageNumber } = spaceEditTarget;
    const payload = spaceHierarchyPayload
      ? JSON.parse(JSON.stringify(spaceHierarchyPayload))
      : { parsed: { spatial_records: [] } };
    if (!payload.parsed) payload.parsed = { spatial_records: [] };
    // Migrate legacy key on save.
    if (Array.isArray(payload.parsed.physical_spaces) && !Array.isArray(payload.parsed.spatial_records)) {
      payload.parsed.spatial_records = payload.parsed.physical_spaces;
      delete payload.parsed.physical_spaces;
    }
    if (!Array.isArray(payload.parsed.spatial_records)) payload.parsed.spatial_records = [];
    const spaces: any[] = payload.parsed.spatial_records;

    // Remove this page from all existing matched_sources.
    for (const sp of spaces) {
      if (!Array.isArray(sp.matched_sources)) sp.matched_sources = [];
      sp.matched_sources = sp.matched_sources.filter(
        (src: any) => !(src?.file_name === fileName && Number(src?.page_number) === Number(pageNumber)),
      );
    }

    // Add page to each selected space (create new space entries if needed).
    for (const name of newSpaces) {
      let entry = spaces.find((s) => s?.standardized_space_name === name);
      if (!entry) {
        entry = { standardized_space_name: name, space_index: null, matched_sources: [] };
        spaces.push(entry);
      }
      if (!Array.isArray(entry.matched_sources)) entry.matched_sources = [];
      entry.matched_sources.push({
        file_name: fileName,
        page_number: pageNumber,
        context_extracted: "User-assigned",
      });
    }

    try {
      const { error } = await supabase
        .from("analysis_requests")
        .update({ space_hierarchy_json: payload } as any)
        .eq("id", analysisRequest.id);
      if (error) throw error;
      toast({ title: "Spaces updated", description: `${fileName} · Page ${pageNumber}` });
      queryClient.invalidateQueries({ queryKey: ["workbench-analysis-request", projectId] });
    } catch (e: any) {
      toast({ title: "Save failed", description: e?.message ?? "Unknown error", variant: "destructive" });
    }
  };

  /** Render a clickable space badge. Returns null if no badge should display. */
  const renderSpaceBadge = (
    fileName: string,
    pageNumber: number,
    opts?: { size?: "sm" | "md" },
  ) => {
    const sps = spacesForSheet(fileName, pageNumber);
    const hasSpaces = sps.length > 0;
    if (!hasSpaces && !hierarchyBuilt) return null;
    const label = hasSpaces ? formatSpaceBadge(sps) : "No Space";
    const cls = hasSpaces
      ? "bg-sky-500/10 text-sky-700 border-sky-500/30"
      : "bg-slate-400/15 text-slate-600 border-slate-400/40 opacity-80";
    const sizeCls =
      opts?.size === "md"
        ? "h-5 px-2 text-[11px]"
        : "h-4 px-1.5 text-[10px]";
    const badge = (
      <Badge
        variant="outline"
        className={`min-w-0 max-w-full leading-none cursor-pointer hover:opacity-80 ${sizeCls} ${cls}`}
        onClick={(e) => {
          e.stopPropagation();
          openSpaceEdit(fileName, pageNumber);
        }}
      >
        <span className="truncate block">{label}</span>
      </Badge>
    );
    if (!hasSpaces) return badge;
    return (
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex min-w-0 max-w-full">{badge}</span>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="start" sideOffset={6} className="max-w-xs">
            <div className="text-xs flex flex-col gap-0.5">
              {sps.map((s) => (
                <div key={s}>{s}</div>
              ))}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  };


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

    // --- Extract Context: three-way branch -------------------------------
    // 1) Resume: any sheet still pending OR the pipeline_phase is stuck on
    //    'extracting' (timed-out prior run). Skip the wipe + only re-process
    //    sheets that don't yet have extracted text.
    // 2) Re-run: every sheet is already extracted → confirm overwrite,
    //    full wipe + re-extract everything (legacy behavior).
    // 3) Fresh: nothing extracted yet → run as today (no confirm, no wipe).
    let isResumeExtract = false;
    if (phase === "extract") {
      const allSheets = rows?.sheets ?? [];
      const totalSheets = allSheets.length;
      const pendingSheets = allSheets.filter(
        (s) => s.extract_status !== "extracted" && s.extract_status !== "skipped",
      ).length;
      const phaseStalledOnExtract =
        (analysisRequest?.pipeline_phase ?? null) === "extracting" &&
        (analysisRequest?.status ?? "") !== "complete";
      const hasAnyExtracted = totalSheets > 0 && pendingSheets < totalSheets;

      if (pendingSheets > 0 && (hasAnyExtracted || phaseStalledOnExtract)) {
        // Resume path
        const msg = phaseStalledOnExtract
          ? `Extract Context appears stalled. Resume? ${pendingSheets} of ${totalSheets} pages still need extraction. Already-extracted pages will be kept.`
          : `Resume extracting context? ${pendingSheets} of ${totalSheets} pages still need extraction.`;
        if (!window.confirm(msg)) return;
        isResumeExtract = true;
      } else {
        const hasPrior = (fileGroups || []).some(
          (g) => fileExtractStatus.get(g.file.id) === "processed",
        );
        if (hasPrior) {
          if (!window.confirm(
            `Extract Context has already run for this project. Re-run and overwrite existing results?`,
          )) {
            return;
          }
        }
      }
    } else {
      const hasPrior =
        phase === "triage"
          ? (triage?.length ?? 0) > 0
          : (analyzeRows?.length ?? 0) > 0;
      if (hasPrior) {
        const label = phase === "triage" ? "Triage" : "Analyze";
        if (!window.confirm(`${label} has already run for this project. Re-run and overwrite existing results?`)) {
          return;
        }
      }
    }
    setRunning(phase);
    try {
      // For a full Extract Context re-run, proactively clear the per-sheet/file
      // extracted text so the "Processed" badges disappear immediately while
      // the new extraction is in flight. Skip this on a Resume so partial
      // progress is preserved.
      if (phase === "extract" && !isResumeExtract) {
        await Promise.all([
          supabase
            .from("analysis_request_sheets")
            .update({ extracted_text: null, extract_status: "pending" })
            .eq("analysis_request_id", requestId),
          supabase
            .from("analysis_request_files")
            .update({ extracted_text: null })
            .eq("analysis_request_id", requestId),
        ]);
        queryClient.invalidateQueries({ queryKey: ["workbench-rows", requestId] });
        queryClient.invalidateQueries({ queryKey: ["workbench-sheets", requestId] });
        queryClient.invalidateQueries({ queryKey: ["workbench-files", requestId] });
      }
      const body: Record<string, unknown> = {
        analysisRequestId: requestId,
        phaseOverride: phase,
      };
      if (phase === "extract" && isResumeExtract) {
        body.resumeExtract = true;
      }
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
      else if (isResumeExtract) toast({ title: "Resuming Extract Context" });
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
      // Build ordering: file name (A→Z) → page_index → created_at.
      const { data: filesData, error: filesErr } = await supabase
        .from("analysis_request_files")
        .select("id, name")
        .eq("analysis_request_id", requestId);
      if (filesErr) throw filesErr;
      const fileOrder = new Map<string, number>();
      (filesData || [])
        .slice()
        .sort((a: any, b: any) =>
          String(a.name || "").localeCompare(String(b.name || ""), undefined, {
            sensitivity: "base",
          }),
        )
        .forEach((f: any, i: number) => fileOrder.set(f.id as string, i));

      let totalReassigned = 0;
      for (const cls of classes) {
        const { data, error } = await supabase
          .from("drawing_instances" as any)
          .select("id, instance_number, file_id, page_index, created_at")
          .eq("analysis_request_id", requestId)
          .eq("awp_class_name", cls);
        if (error) throw error;
        const rows = (((data as unknown) as Array<{
          id: string;
          instance_number: number | null;
          file_id: string;
          page_index: number | null;
          created_at: string;
        }>) || []).slice();
        rows.sort((a, b) => {
          const fa = fileOrder.get(a.file_id) ?? Number.MAX_SAFE_INTEGER;
          const fb = fileOrder.get(b.file_id) ?? Number.MAX_SAFE_INTEGER;
          if (fa !== fb) return fa - fb;
          const pa = a.page_index ?? 0;
          const pb = b.page_index ?? 0;
          if (pa !== pb) return pa - pb;
          return a.created_at.localeCompare(b.created_at);
        });
        // Two-phase update to avoid uniqueness collisions if a future
        // (request, class, number) constraint is added: bump to negative
        // temporaries first, then write final numbers.
        for (let i = 0; i < rows.length; i++) {
          const { error: upErr } = await supabase
            .from("drawing_instances" as any)
            .update({ instance_number: -(i + 1) })
            .eq("id", rows[i].id);
          if (upErr) throw upErr;
        }
        for (let i = 0; i < rows.length; i++) {
          const desired = i + 1;
          const { error: upErr } = await supabase
            .from("drawing_instances" as any)
            .update({ instance_number: desired })
            .eq("id", rows[i].id);
          if (upErr) throw upErr;
          if (rows[i].instance_number !== desired) totalReassigned += 1;
        }
      }
      toast({
        title: "IDs renumbered",
        description: `Reassigned ${totalReassigned} annotation${totalReassigned === 1 ? "" : "s"} across ${classes.length} class${classes.length === 1 ? "" : "es"}.`,
      });
      queryClient.invalidateQueries({ queryKey: ["workbench-instances", requestId] });
      setCleanupOpen(false);
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "Renumber failed",
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
          space_hierarchy_json: null,
          space_hierarchy_status: null,
          space_hierarchy_error: null,
          space_hierarchy_updated_at: null,
        } as any)
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

  // ---- Per-cell (single sheet × class) actions --------------------------
  const runCell = async (
    sheetId: string,
    awpClassName: string,
    phase: "triage" | "analyze",
  ) => {
    if (!requestId) return;
    try {
      const { error } = await supabase.functions.invoke("run-analysis-pipeline", {
        body: {
          analysisRequestId: requestId,
          phaseOverride: phase,
          enabledAwpClasses: [awpClassName],
          scopedSheetIds: [sheetId],
        },
      });
      if (error) throw error;
      toast({ title: phase === "triage" ? "Triage started for cell" : "Analyze started for cell" });
      queryClient.invalidateQueries({ queryKey: ["workbench-triage", requestId] });
      queryClient.invalidateQueries({ queryKey: ["workbench-analyze", requestId] });
      queryClient.invalidateQueries({ queryKey: ["workbench-jobs", requestId] });
      queryClient.invalidateQueries({
        queryKey: ["workbench-analysis-request", projectId],
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: `Could not start ${phase}`,
        description: getUserFriendlyError(error),
      });
    }
  };

  const clearCell = async (sheetId: string, awpClassName: string) => {
    if (!requestId) return;
    try {
      await Promise.all([
        supabase
          .from("analysis_triage_results")
          .delete()
          .eq("analysis_request_id", requestId)
          .eq("sheet_id", sheetId)
          .eq("awp_class_name", awpClassName),
        supabase
          .from("analysis_results")
          .delete()
          .eq("analysis_request_id", requestId)
          .eq("sheet_id", sheetId)
          .eq("awp_class_name", awpClassName),
      ]);
      queryClient.invalidateQueries({ queryKey: ["workbench-triage", requestId] });
      queryClient.invalidateQueries({ queryKey: ["workbench-analyze", requestId] });
      toast({ title: "Cell cleared" });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Could not clear cell",
        description: getUserFriendlyError(error),
      });
    }
  };

  // ---- Spatial Architect (replaces Build Space Hierarchy) ---------------
  const buildSpaceHierarchy = async () => {
    if (!requestId) return;
    if (spaceHierarchyHasResult) {
      if (!window.confirm("Spatial Architect has already run for this project. Re-run and overwrite existing results?")) {
        return;
      }
    }
    setBuildingSpace(true);
    try {
      const token = session?.access_token;
      if (!token) throw new Error("Your session expired. Please sign in again.");
      // Clear existing space hierarchy immediately so the space badges
      // disappear while the build is running.
      await supabase
        .from("analysis_requests")
        .update({
          space_hierarchy_json: null,
          space_hierarchy_status: "running",
          space_hierarchy_error: null,
          space_hierarchy_updated_at: new Date().toISOString(),
        } as any)
        .eq("id", requestId);
      queryClient.invalidateQueries({
        queryKey: ["workbench-analysis-request", projectId],
      });
      const { data, error } = await supabase.functions.invoke("spatial-architect", {
        body: { analysisRequestId: requestId },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({ title: "Spatial Architect complete" });
      queryClient.invalidateQueries({
        queryKey: ["workbench-analysis-request", projectId],
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Spatial Architect failed",
        description: getUserFriendlyError(error),
      });
    } finally {
      setBuildingSpace(false);
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
          <div className="container mx-auto px-6 pt-4 pb-6 space-y-4">
            {/* Action toolbar — the Agents row lives further below in the
                page (Scout · Vulnerability Radar · Spatial Architect · Unify
                Riser · Threat Report · Clear All · Renumber IDs · 🐛). */}


            {/* Survey Pages */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-start gap-2">
                <span className="text-sm font-medium text-muted-foreground mr-1">Agents:</span>
                <Button
                  type="button"
                  onClick={async () => {
                    if (!requestId) return;
                    // Collect original PDFs attached to this request.
                    const { data: filesData, error: filesErr } = await supabase
                      .from("analysis_request_files")
                      .select("id, name")
                      .eq("analysis_request_id", requestId)
                      .order("name");
                    if (filesErr) {
                      toast({ variant: "destructive", title: "Survey Pages failed", description: filesErr.message });
                      return;
                    }
                    const files = (filesData ?? []) as Array<{ id: string; name: string }>;
                    if (files.length === 0) {
                      toast({ variant: "destructive", title: "No files", description: "This analysis request has no source PDFs." });
                      return;
                    }

                    setSurveyRunning(true);
                    setSurveyRecoveredRun(false);
                    setSurveyResults([]);
                    setSurveyRawText("");
                    

                    const aggregated: typeof surveyResults = [];
                    const rawChunks: string[] = [];
                    let totalSheets = 0;
                    let withResult = 0;

                    try {
                      for (let i = 0; i < files.length; i++) {
                        const f = files[i];
                        window.sessionStorage.setItem(
                          surveyProgressStorageKey(requestId),
                          JSON.stringify({ current: i + 1, total: files.length, fileName: f.name, phase: "uploading" }),
                        );
                        setSurveyProgress({
                          current: i + 1,
                          total: files.length,
                          fileName: f.name,
                          phase: "uploading",
                        });
                        // Tiny tick so the UI renders "uploading" before invoke blocks.
                        await new Promise((r) => setTimeout(r, 30));
                        window.sessionStorage.setItem(
                          surveyProgressStorageKey(requestId),
                          JSON.stringify({ current: i + 1, total: files.length, fileName: f.name, phase: "querying" }),
                        );
                        setSurveyProgress({
                          current: i + 1,
                          total: files.length,
                          fileName: f.name,
                          phase: "querying",
                        });

                        // Capture the baseline updated_at so we can detect
                        // when the background job finishes.
                        const { data: baselineRow } = await supabase
                          .from("analysis_request_files")
                          .select("survey_raw_updated_at")
                          .eq("id", f.id)
                          .maybeSingle();
                        const baselineUpdatedAt = (baselineRow as any)?.survey_raw_updated_at ?? null;

                        const { data, error } = await supabase.functions.invoke("survey-pages", {
                          body: { analysisRequestId: requestId, fileId: f.id },
                        });
                        if (error) throw error;
                        if ((data as any)?.error) throw new Error((data as any).error);

                        // Poll for completion (background job writes
                        // survey_raw_updated_at last). Up to 8 minutes.
                        const maxAttempts = 240;
                        let attempts = 0;
                        let finalRawText = "";
                        while (attempts < maxAttempts) {
                          await new Promise((r) => setTimeout(r, 2000));
                          attempts++;
                          const { data: pollRow } = await supabase
                            .from("analysis_request_files")
                            .select("survey_raw_response, survey_raw_updated_at")
                            .eq("id", f.id)
                            .maybeSingle();
                          const updatedAt = (pollRow as any)?.survey_raw_updated_at ?? null;
                          if (updatedAt && updatedAt !== baselineUpdatedAt) {
                            finalRawText = (pollRow as any)?.survey_raw_response ?? "";
                            if (finalRawText.startsWith("ERROR: ")) {
                              throw new Error(finalRawText.slice(7));
                            }
                            break;
                          }
                        }
                        if (!finalRawText && attempts >= maxAttempts) {
                          throw new Error(`Timed out waiting for Survey Pages on ${f.name}.`);
                        }

                        // Fetch persisted sheet results for this file.
                        const { data: sheetRows, error: sheetsErr } = await supabase
                          .from("analysis_request_sheets")
                          .select("id, page_index, sheet_number, survey_result")
                          .eq("analysis_request_id", requestId!)
                          .eq("parent_file_id", f.id)
                          .order("page_index", { ascending: true });
                        if (sheetsErr) throw sheetsErr;

                        const results = (sheetRows ?? []).map((s: any) => ({
                          sheetId: s.id,
                          file: f.name,
                          page: s.page_index,
                          sheet_number: s.sheet_number,
                          content: formatSurveyContent(s.survey_result),
                        })) as typeof surveyResults;
                        aggregated.push(...results);
                        rawChunks.push(`===== ${f.name} =====\n${finalRawText}`);
                        totalSheets += results.length;
                        withResult += results.filter((r) => r.content.trim().length > 0).length;

                        // Stream results into the UI as each file finishes.
                        setSurveyResults([...aggregated]);
                        setSurveyRawText(rawChunks.join("\n\n"));
                      }

                      setSurveyProgress({
                        current: files.length,
                        total: files.length,
                        fileName: "",
                        phase: "done",
                      });
                      window.sessionStorage.removeItem(surveyProgressStorageKey(requestId));
                      toast({
                        title: "Survey Pages complete",
                        description: `${withResult} of ${totalSheets} pages received a result across ${files.length} file${files.length === 1 ? "" : "s"}.`,
                      });
                    } catch (err: unknown) {
                      window.sessionStorage.removeItem(surveyProgressStorageKey(requestId));
                      const message = err instanceof Error ? err.message : "Unknown error";
                      toast({
                        variant: "destructive",
                        title: "Survey Pages failed",
                        description: message,
                      });
                    } finally {
                      setSurveyRunning(false);
                    }
                  }}
                  variant="outline"
                  disabled={!requestId || surveyRunning}
                >
                  {surveyRunning ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Surveying pages…
                    </>
                  ) : (
                    "Scout"
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!requestId || surveyRunning || identifyRunning || enabledCols.length === 0}
                  onClick={async () => {
                    if (!requestId || !rows?.files?.length) return;
                    setIdentifyRunning(true);
                    try {
                      const results = await Promise.allSettled(
                        rows.files.map((f) =>
                          supabase.functions.invoke("identify-risk-elements", {
                            body: {
                              analysisRequestId: requestId,
                              fileId: f.id,
                              awpClassNames: enabledCols,
                            },
                          }),
                        ),
                      );
                      const ok = results.filter((r) => r.status === "fulfilled" && !(r.value as any)?.error).length;
                      const failed = results.length - ok;
                      toast({
                        title: "Identify Risk Elements dispatched",
                        description: `${ok} file${ok === 1 ? "" : "s"} started${failed ? `, ${failed} failed` : ""}.`,
                        variant: failed ? "destructive" : "default",
                      });
                    } catch (err: any) {
                      toast({
                        variant: "destructive",
                        title: "Identify Risk Elements failed",
                        description: err?.message ?? "Unknown error",
                      });
                    } finally {
                      setIdentifyRunning(false);
                    }
                  }}
                >
                  {identifyRunning ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Identifying…
                    </>
                  ) : (
                    "Vulnerability Radar"
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={buildSpaceHierarchy}
                  disabled={!requestId || spaceHierarchyRunning}
                  title="Normalize Scout's per-page level/unit labels into a canonical space hierarchy."
                >
                  {spaceHierarchyRunning ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Architecting…
                    </>
                  ) : (
                    "Spatial Architect"
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setConsolidateOpen(true)}
                  disabled={!requestId || spannableClassesWithAnnotations.length === 0 || !hasRisersSelected}
                  title={
                    !hasRisersSelected
                      ? "Select Electrical Riser or Mechanical Riser columns to enable"
                      : spannableClassesWithAnnotations.length === 0
                      ? "No Risers identified"
                      : "Group annotations of riser-type classes into multi-space instances before generating the threat report"
                  }
                >
                  Unify Risers
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setInstancesReportOpen(true)}
                  disabled={!requestId || !spaceHierarchyHasResult}
                  title={
                    !spaceHierarchyHasResult
                      ? "Run Spatial Architect first to generate the threat report."
                      : "Generate per-space threat report"
                  }
                >
                  Threat Report
                </Button>

                <div className="flex-1" />

                {analysisRequest && totalFiles > 0 && enabledCols.length > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setCleanupChecked(new Set());
                      setCleanupOpen(true);
                    }}
                  >
                    Renumber IDs
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setClearOpen(true)}
                  disabled={!requestId || phaseRunning}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Clear All
                </Button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => setScoutDebugOpen(true)}
                      aria-label="Scout debug"
                    >
                      <Bug className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Scout debug</TooltipContent>
                </Tooltip>

              </div>

              {/* Raw response modal — shown when a file is picked from the Scout debug list. */}
              <Dialog
                open={!!surveyResponseModal}
                onOpenChange={(open) => !open && setSurveyResponseModal(null)}
              >
                <DialogContent className="max-w-[80vw] w-[80vw] h-[80vh] flex flex-col">
                  <DialogHeader>
                    <DialogTitle className="truncate">
                      Survey response · {surveyResponseModal?.fileName}
                    </DialogTitle>
                  </DialogHeader>
                  <Textarea
                    readOnly
                    value={surveyResponseModal?.raw ?? ""}
                    className="font-mono text-xs flex-1 min-h-0 resize-none"
                  />
                </DialogContent>
              </Dialog>

              {/* Scout debug modal — lists files with raw responses; pick one to view. */}
              <Dialog open={scoutDebugOpen} onOpenChange={setScoutDebugOpen}>
                <DialogContent className="max-w-[640px] w-[640px] max-h-[80vh] flex flex-col">
                  <DialogHeader>
                    <DialogTitle>Scout responses</DialogTitle>
                  </DialogHeader>
                  {(() => {
                    const scoutFiles = (rows?.files ?? [])
                      .filter((f) => (f.survey_raw_response ?? "").trim().length > 0)
                      .slice()
                      .sort((a, b) => {
                        const au = (a as any).survey_raw_updated_at ?? "";
                        const bu = (b as any).survey_raw_updated_at ?? "";
                        return bu.localeCompare(au);
                      });
                    if (scoutFiles.length === 0) {
                      return (
                        <div className="flex-1 flex items-center justify-center py-8 text-sm text-muted-foreground">
                          No Scout responses yet. Run Scout to populate.
                        </div>
                      );
                    }
                    return (
                      <div className="flex-1 min-h-0 flex flex-col gap-2">
                        <div className="text-xs text-muted-foreground">
                          Model: google/gemini-2.5-pro · {scoutFiles.length} file{scoutFiles.length === 1 ? "" : "s"} with responses
                        </div>
                        <ul className="divide-y border rounded-md overflow-auto flex-1 min-h-0">
                          {scoutFiles.map((f) => {
                            const updatedAt = (f as any).survey_raw_updated_at as string | null;
                            const len = (f.survey_raw_response ?? "").length;
                            return (
                              <li
                                key={f.id}
                                className="px-3 py-2 flex items-center justify-between gap-3"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="text-sm font-medium truncate">{f.name}</div>
                                  <div className="text-[11px] text-muted-foreground">
                                    {updatedAt ? new Date(updatedAt).toLocaleString() : "—"} · {len.toLocaleString()} chars
                                  </div>
                                </div>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setScoutDebugOpen(false);
                                    setSurveyResponseModal({
                                      fileName: f.name,
                                      raw: f.survey_raw_response ?? "",
                                    });
                                  }}
                                >
                                  View Response
                                </Button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })()}
                </DialogContent>
              </Dialog>
            </div>


            <div className="mt-6 space-y-3">

              {pageInfoRows.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-6">
                  {pageInfoLoading ? "Loading…" : "No files in this request."}
                </div>
              ) : (
                <div className="bg-card rounded-lg border relative [&>div]:overflow-visible">
                  <Table>
                    <TableHeader className="sticky top-0 z-20 bg-card shadow-sm">
                      <TableRow className="bg-card">
                        <TableHead className={`${stickyHeadFirst} h-9 py-1`}>
                          <div className="inline-flex items-center gap-1.5">
                            <span>Files ({pageInfoRows.length} file{pageInfoRows.length === 1 ? "" : "s"})</span>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  onClick={handleDownloadAllFiles}
                                  disabled={downloadingAll || pageInfoRows.length === 0}
                                  className="text-muted-foreground hover:text-foreground p-0.5 rounded hover:bg-muted/50 disabled:opacity-50 disabled:cursor-not-allowed"
                                  aria-label="Download all files"
                                >
                                  <Download className={`h-3.5 w-3.5 ${downloadingAll ? "animate-pulse" : ""}`} />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="bottom">
                                {downloadingAll ? "Preparing ZIP…" : "Download all files (ZIP)"}
                              </TooltipContent>
                            </Tooltip>
                          </div>
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
                              className="text-center whitespace-nowrap h-9 py-1 bg-card"
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
                                  <TooltipContent side="bottom">{name} — click to view prompt</TooltipContent>
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
                        <TableHead className="text-right w-[1%] whitespace-nowrap h-9 py-1 bg-card">
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={openManage}
                            disabled={phaseRunning}
                            aria-label="Manage columns"
                            title={
                              customClassNames.length > 0
                                ? `Custom class${customClassNames.length === 1 ? "" : "es"} were typed at project creation: ${customClassNames.join(", ")}`
                                : "Manage columns"
                            }
                            className={`h-8 w-8 ${
                              customClassNames.length > 0
                                ? "bg-yellow-300 hover:bg-yellow-400 text-yellow-900 border-yellow-500"
                                : ""
                            }`}
                          >
                            <Settings2 className="h-4 w-4" />
                          </Button>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pageInfoRows.map((row) => {
                        const count = row.page_count ?? 0;
                        const singlePage = count === 1;
                        const isExpanded = pageInfoExpanded.has(row.id);

                        const renderTriageCell = (
                          fileId: string,
                          awpClassName: string,
                          cnt: number,
                          scoreKnown: boolean,
                          score?: number,
                        ) => {
                          const key = `${fileId}::${awpClassName}`;
                          const override = overrideMap.get(key);
                          const clickable = hasTriageRun;
                          const hasScore = typeof score === "number";
                          const opacity = hasScore ? Math.max(0, Math.min(100, score!)) / 100 : 0;
                          const inner =
                            cnt > 0 ? (
                              <span className="font-medium tabular-nums">{cnt}</span>
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
                                  ? `Triage: ${score}%${cnt > 0 ? ` · ${cnt}` : ""} — click to ${cnt > 0 ? "exclude" : "include"}`
                                  : cnt > 0
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
                                toggleOverride(fileId, awpClassName, cnt);
                              }}
                            >
                              <span className="inline-flex items-center justify-center w-full">
                                {override === "exclude" ? (
                                  <span className="line-through text-muted-foreground">
                                    {cnt > 0 ? cnt : "—"}
                                  </span>
                                ) : (
                                  inner
                                )}
                              </span>
                            </TableCell>
                          );
                        };

                        return (
                          <Fragment key={row.id}>
                            {/* File-level row — matches first table */}
                            <TableRow
                              className="group h-8 cursor-pointer"
                              onClick={() => {
                                if (singlePage) setActivePageView({ file: row, page: 1 });
                                else if (count > 0) togglePageInfoExpand(row.id);
                              }}
                            >
                              <TableCell
                                className={`${stickyCellFirstBase} bg-card group-hover:bg-muted/50 py-1 text-sm`}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  {!singlePage && count > 0 ? (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        togglePageInfoExpand(row.id);
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
                                    {row.name}
                                  </span>
                                  {!singlePage && count > 0 && (
                                    <span className="text-xs text-muted-foreground shrink-0">
                                      {count} pages
                                    </span>
                                  )}
                                </div>
                              </TableCell>
                              {enabledCols.map((name) => {
                                const baseCount =
                                  fileCountLookup.get(`${row.id}::${name}`) || 0;
                                const userCount =
                                  instanceCountLookup.get(`${row.id}::${name}`) || 0;
                                const cnt = baseCount + userCount;
                                const fileScore = fileScoreLookup.get(`${row.id}::${name}`);
                                const scoreKnown =
                                  fileScore != null ||
                                  (triage || []).some(
                                    (t) => t.file_id === row.id && t.awp_class_name === name,
                                  ) ||
                                  userCount > 0 ||
                                  baseCount > 0;
                                return renderTriageCell(row.id, name, cnt, scoreKnown, fileScore);
                              })}
                              <TableCell className="py-1" />
                            </TableRow>

                            {/* Per-page sub-rows (only when multi-page AND expanded) — matches first table */}
                            {!singlePage && isExpanded && count > 0 &&
                              Array.from({ length: count }, (_, i) => i + 1).map((p) => {
                                const pagePlans =
                                  floorPlansByFile.get(row.id)?.get(p) ?? [];
                                const levelPlans = pagePlans.filter(
                                  (p) => p.type === "level_floor_plan",
                                );
                                const unitPlans = pagePlans.filter(
                                  (p) => p.type === "unit_floor_plan",
                                );
                                return (
                                  <TableRow
                                    key={`${row.id}:${p}`}
                                    className="group h-8 cursor-pointer bg-muted/10"
                                    onClick={() => setActivePageView({ file: row, page: p })}
                                  >
                                    <TableCell
                                      className={`${stickyCellFirstBase} bg-muted/10 group-hover:bg-muted/30 py-1 text-sm`}
                                    >
                                      <div className="flex items-center gap-1.5 min-w-0 pl-7 flex-wrap">
                                        <span className="text-muted-foreground shrink-0">
                                          Page {p}
                                        </span>
                                        {levelPlans.map((lvl) => {
                                          const c = awpClassColor(lvl.type === "level_floor_plan" ? "Level Floor Plan" : lvl.type === "unit_floor_plan" ? "Unit Floor Plan" : lvl.type);
                                          const lbl = floorPlanDisplayLabel(lvl);
                                          return (
                                            <Badge
                                              key={`lvl-${lvl.plan_id}`}
                                              variant="outline"
                                              className="h-5 px-1.5 text-[10px]"
                                              style={{ backgroundColor: softBgFrom(c), color: c, borderColor: softBgFrom(c, 0.5) }}
                                            >
                                              {lbl}
                                            </Badge>
                                          );
                                        })}
                                        {unitPlans.length > 0 && (() => {
                                          const c = awpClassColor("Unit Floor Plan");
                                          return (
                                            <Badge
                                              variant="outline"
                                              className="h-5 px-1.5 text-[10px]"
                                              style={{ backgroundColor: softBgFrom(c), color: c, borderColor: softBgFrom(c, 0.5) }}
                                            >
                                              {unitPlans.length} unit plan{unitPlans.length === 1 ? "" : "s"}
                                            </Badge>
                                          );
                                        })()}

                                      </div>
                                    </TableCell>
                                    {enabledCols.map((name) => {
                                      const cnt =
                                        pageInstanceCountLookup.get(
                                          `${row.id}::${p}::${name}`,
                                        ) || 0;
                                      return (
                                        <TableCell
                                          key={name}
                                          className="text-center py-1"
                                        >
                                          {cnt > 0 ? (
                                            <span className="font-medium tabular-nums">
                                              {cnt}
                                            </span>
                                          ) : (
                                            <span className="text-muted-foreground">—</span>
                                          )}
                                        </TableCell>
                                      );
                                    })}
                                    <TableCell className="py-1" />
                                  </TableRow>
                                );
                              })
                            }
                          </Fragment>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>

            {/* Upload Report - moved below Pages by File table */}
            <div className="flex items-center justify-end gap-3 mt-4">
              <input
                ref={reportInputRef}
                type="file"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file || !projectId) return;
                  setUploadingReport(true);
                  try {
                    const safeName = file.name.replace(/[^\w.\-]+/g, "_");
                    const path = `${projectId}/report-${Date.now()}-${safeName}`;
                    const { error: upErr } = await supabase.storage
                      .from("project-reports")
                      .upload(path, file, { upsert: true, contentType: file.type || undefined });
                    if (upErr) throw upErr;
                    const prevPath = (project as any)?.report_file_path as string | null | undefined;
                    const { error: updErr } = await supabase
                      .from("projects")
                      .update({ report_file_path: path, report_file_name: file.name } as any)
                      .eq("id", projectId);
                    if (updErr) throw updErr;
                    if (prevPath && prevPath !== path) {
                      await supabase.storage.from("project-reports").remove([prevPath]);
                    }
                    queryClient.invalidateQueries({ queryKey: ["workbench-project", projectId] });
                    toast({ title: "Report uploaded", description: file.name });
                  } catch (err: any) {
                    toast({ variant: "destructive", title: "Upload failed", description: getUserFriendlyError(err) });
                  } finally {
                    setUploadingReport(false);
                  }
                }}
              />
              {(project as any)?.report_file_name ? (
                <button
                  type="button"
                  className="text-sm text-primary hover:underline truncate text-right max-w-[40ch]"
                  onClick={async () => {
                    const path = (project as any)?.report_file_path;
                    if (!path) return;
                    const { data, error } = await supabase.storage
                      .from("project-reports")
                      .createSignedUrl(path, 60, {
                        download: (project as any)?.report_file_name || true,
                      });
                    if (error || !data?.signedUrl) {
                      toast({ variant: "destructive", title: "Download failed", description: getUserFriendlyError(error) });
                      return;
                    }
                    window.open(data.signedUrl, "_blank");
                  }}
                >
                  {(project as any).report_file_name}
                </button>
              ) : (
                <span className="text-sm text-muted-foreground">No report uploaded yet.</span>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => reportInputRef.current?.click()}
                disabled={uploadingReport}
              >
                {uploadingReport ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Upload className="h-3.5 w-3.5 mr-1.5" />
                )}
                Upload Report
              </Button>
            </div>



          </div>
        </main>






        {/* Drawing modal — single sheet */}
        {activeSheet && sheetSource && (
          <FileViewerModal
            isOpen={!!activeSheet}
            onClose={() => { setActiveSheet(null); setPreselectClass(null); }}
            fileId={activeSheet.id}
            fileName={(() => {
              const single =
                fileGroups.find((g) => g.file.id === activeSheet.parent_file_id)?.sheets
                  .length === 1;
              return single
                ? activeSheet.file_name
                : `${activeSheet.file_name} | Page ${activeSheet.page_index}`;
            })()}
            titleAccessory={
              <span className="inline-flex items-center max-w-[40%] shrink-0">
                {renderSpaceBadge(activeSheet.file_name, activeSheet.page_index, { size: "md" })}
              </span>
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
              queryClient.refetchQueries({ queryKey: ["workbench-instances", requestId] });
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
              queryClient.refetchQueries({ queryKey: ["workbench-instances", requestId] });
            }}
            persistKey={projectId}
            expandedClasses={sidebarExpandedClasses}
            onExpandedClassesChange={setSidebarExpandedClasses}
            preselectClass={preselectClass}
          />
        )}

        {/* Single-page viewer for Pages by File table */}
        {activePageView && activePageViewSource && (
          <FileViewerModal
            isOpen={!!activePageView}
            onClose={() => setActivePageView(null)}
            fileId={activePageView.file.id}
            fileName={`${activePageView.file.name} | Page ${activePageView.page}`}
            mimeType={activePageView.file.mime_type || "application/pdf"}
            accessToken=""
            detections={[]}
            sourceOverride={activePageViewSource}
            analysisRequestId={requestId}
            parentFileId={activePageView.file.id}
            sheetId={activeSheetIdForPage}
            pageIndex={activePageView.page}
            floorPlans={activePageFloorPlans}
            allUnitPlans={activeFileAllUnitPlans}
            allLevelPlans={activeFileAllLevelPlans}
            floorPlanOverrides={activeFloorPlanOverrides}
            onSaveFloorPlanOverride={saveFloorPlanOverride}
            onEditFloors={openFloorEditForPlan}
            onSaveLevelUnits={async (plan, units, createdRefs, removedRefs) => {
              const fileId = activePageView.file.id;
              const page = activePageView.page;
              const { data: sheet, error: sheetErr } = await supabase
                .from("analysis_request_sheets")
                .select("id, floor_plan_overrides")
                .eq("parent_file_id", fileId)
                .eq("page_index", page)
                .maybeSingle();
              if (sheetErr || !sheet) {
                toast({
                  variant: "destructive",
                  title: "Cannot save units",
                  description: sheetErr?.message ?? "No sheet row found for this page.",
                });
                return;
              }
              const existing =
                ((sheet as any).floor_plan_overrides as Record<string, any>) ?? {};
              const merged: Record<string, any> = {
                ...existing,
                [plan.plan_id]: { ...(existing[plan.plan_id] ?? {}), units },
              };
              // Persist any newly-created refs as user-added unit floor plans.
              const existingAdded = Array.isArray(existing[ADDED_UNIT_PLANS_KEY])
                ? (existing[ADDED_UNIT_PLANS_KEY] as any[])
                : [];
              let nextAdded = existingAdded;
              if (createdRefs && createdRefs.length > 0) {
                const existingRefs = new Set(
                  existingAdded
                    .filter((e) => e?.page_number === page)
                    .map((e) => e?.reference_id),
                );
                const toAdd = createdRefs
                  .filter((r) => !existingRefs.has(r))
                  .map((r) => ({
                    plan_id: makeAddedUnitPlanId(r, page),
                    reference_id: r,
                    page_number: page,
                  }));
                if (toAdd.length > 0) nextAdded = [...nextAdded, ...toAdd];
              }
              if (removedRefs && removedRefs.length > 0) {
                const removeSet = new Set(removedRefs);
                nextAdded = nextAdded.filter(
                  (e) =>
                    !(e?.page_number === page && removeSet.has(e?.reference_id)),
                );
              }
              if (nextAdded !== existingAdded) {
                merged[ADDED_UNIT_PLANS_KEY] = nextAdded;
              }
              const { error } = await supabase
                .from("analysis_request_sheets")
                .update({ floor_plan_overrides: merged } as any)
                .eq("id", (sheet as any).id);
              if (error) {
                toast({
                  variant: "destructive",
                  title: "Could not save units",
                  description: getUserFriendlyError(error),
                });
                return;
              }
              if (activeSheetIdForPage === (sheet as any).id) {
                setActiveFloorPlanOverrides(merged);
              }
              queryClient.invalidateQueries({ queryKey: ["workbench-rows", requestId] });
            }}
            singlePageOnly
            awpClasses={enabledCols.map((name) => ({
              name,
              prefix: optionByName.get(name)?.idPrefix ?? null,
              analysisCount:
                fileCountLookup.get(`${activePageView.file.id}::${name}`) || 0,
            }))}
            fileNameById={Object.fromEntries(
              fileGroups.map((g) => [g.file.id, g.file.name]),
            )}
            persistKey={projectId}
            expandedClasses={sidebarExpandedClasses}
            onExpandedClassesChange={setSidebarExpandedClasses}
            riskElementClasses={activeFileRiskClasses}
            onDeletePlan={deleteFloorPlan}
            onAddPlan={addFloorPlan}
            onInstancesChanged={() => {
              queryClient.refetchQueries({ queryKey: ["workbench-instances", requestId] });
            }}
          />

        )}



        {/* AWP class prompt modal */}
        <AwpPromptModal
          className={promptClass}
          onClose={() => setPromptClass(null)}
        />

        {/* Space edit modal */}
        {spaceEditTarget && (
          <SpaceEditModal
            isOpen={!!spaceEditTarget}
            onClose={() => setSpaceEditTarget(null)}
            fileName={spaceEditTarget.fileName}
            pageNumber={spaceEditTarget.pageNumber}
            currentSpaces={spaceEditTarget.current}
            allSpaces={allSpaceNames}
            onSave={handleSaveSpaces}
            promptText={(spaceHierarchyPayload as any)?.prompt_text ?? null}
            basePrompt={(spaceHierarchyPayload as any)?.base_prompt ?? null}
          />
        )}







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
              {projectSelectedClassNames.length > 0 && (
                <div className="text-xs text-muted-foreground pt-2">
                  <span className="font-medium text-foreground">
                    Original selection at project creation:
                  </span>{" "}
                  {projectSelectedClassNames.join(", ")}
                </div>
              )}
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

        {/* Clean Up ID Assignment modal */}
        <Dialog open={cleanupOpen} onOpenChange={(o) => !cleanupRunning && setCleanupOpen(o)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Renumber IDs</DialogTitle>
              <DialogDescription>
                Select classes to renumber. Annotation IDs for each selected
                class will be reassigned starting from 1, across all pages and
                files in this analysis.
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[50vh] overflow-auto space-y-2 py-2">
              {enabledCols.length === 0 ? (
                <div className="text-sm text-muted-foreground">No classes selected.</div>
              ) : (
                enabledCols.map((name) => {
                  const opt = optionByName.get(name);
                  const checked = cleanupChecked.has(name);
                  return (
                    <label
                      key={name}
                      className="flex items-center gap-2 text-sm cursor-pointer"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => {
                          setCleanupChecked((prev) => {
                            const next = new Set(prev);
                            if (next.has(name)) next.delete(name);
                            else next.add(name);
                            return next;
                          });
                        }}
                      />
                      <span>
                        {opt?.idPrefix && (
                          <span className="font-mono text-xs text-muted-foreground mr-2">
                            {opt.idPrefix}
                          </span>
                        )}
                        {name}
                      </span>
                    </label>
                  );
                })
              )}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setCleanupOpen(false)}
                disabled={cleanupRunning}
              >
                Cancel
              </Button>
              <Button
                onClick={runCleanupIdAssignment}
                disabled={cleanupRunning || cleanupChecked.size === 0}
              >
                {cleanupRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : "Renumber"}
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

        <SpaceHierarchyModal
          open={spaceModalOpen}
          onOpenChange={setSpaceModalOpen}
          payload={spaceHierarchyHasResult ? spaceHierarchyPayload ?? null : null}
        />

        <InstancesReportModal
          open={instancesReportOpen}
          onOpenChange={setInstancesReportOpen}
          requestId={requestId}
          fileGroups={fileGroups}
          optionByName={optionByName}
          pageSpaceMap={pageSpaceMap}
          pageSpaceUnitMap={pageSpaceUnitMap}

          spaceHierarchyPayload={spaceHierarchyPayload}
          projectName={project?.name || "Project"}
          enabledClassNames={enabledCols}
          consolidations={consolidations || []}
        />

        <ConsolidateRisersModal
          open={consolidateOpen}
          onOpenChange={setConsolidateOpen}
          requestId={requestId}
          spannableClasses={spannableClassesWithAnnotations}
          fileNameById={new Map(fileGroups.map((g) => [g.file.id, g.file.name]))}
          pageSpaceMap={pageSpaceMap}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ["workbench-consolidations", requestId] });
          }}
        />
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
// SpaceHierarchyModal — pretty-printed JSON viewer with copy
// ---------------------------------------------------------------------------
function SpaceHierarchyModal({
  open,
  onOpenChange,
  payload,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  payload: any | null;
}) {
  const [copied, setCopied] = useState(false);
  const pretty = useMemo(() => {
    if (!payload) return "";
    const parsed = (payload as any)?.parsed;
    const target = parsed ?? (payload as any)?.raw_text ?? payload;
    try {
      return typeof target === "string" ? target : JSON.stringify(target, null, 2);
    } catch {
      return String(target);
    }
  }, [payload]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Space Hierarchy</DialogTitle>
          <DialogDescription>
            {payload?.generated_at
              ? `Generated ${new Date(payload.generated_at).toLocaleString()} · model ${payload.model ?? "?"} · ${payload.input_chars ?? 0} chars${
                  payload.input_truncated ? " (truncated)" : ""
                }${payload.parse_error ? " · ⚠ JSON parse failed" : ""}`
              : "No result yet."}
          </DialogDescription>
        </DialogHeader>
        <pre className="text-xs bg-muted/40 p-3 rounded-md max-h-[60vh] overflow-auto whitespace-pre-wrap break-words">
{pretty || "(empty)"}
        </pre>
        {payload?.parse_error && payload?.raw_text && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">Raw response</summary>
            <pre className="mt-2 bg-muted/40 p-3 rounded-md max-h-[40vh] overflow-auto whitespace-pre-wrap break-words">
{payload.raw_text}
            </pre>
          </details>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              navigator.clipboard.writeText(pretty);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? <Check className="h-4 w-4 mr-1.5" /> : <Copy className="h-4 w-4 mr-1.5" />}
            {copied ? "Copied" : "Copy JSON"}
          </Button>
          <Button onClick={() => onOpenChange(false)}>Close</Button>
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
          {copied ? "Copied" : "Copy"}
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

// ---------------------------------------------------------------------------
// InstancesReportModal — translates annotations to per-space instance IDs
// ---------------------------------------------------------------------------
function InstancesReportModal({
  open,
  onOpenChange,
  requestId,
  fileGroups,
  optionByName,
  pageSpaceMap,
  pageSpaceUnitMap,
  spaceHierarchyPayload,
  projectName,
  enabledClassNames,
  consolidations,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  requestId: string | undefined;
  fileGroups: Array<{ file: FileRow; sheets: SheetRow[] }>;
  optionByName: Map<string, { idPrefix: string | null; category: string }>;
  pageSpaceMap: Map<string, string[]>;
  pageSpaceUnitMap: Map<string, Array<{ level: string; unit?: string }>>;
  spaceHierarchyPayload: any | null | undefined;
  projectName: string;
  enabledClassNames: string[];
  consolidations: Array<{
    id: string;
    awp_class_name: string;
    label: string;
    instance_number: number | null;
    member_annotation_ids: string[];
  }>;
}) {
  const enabledClassSet = useMemo(
    () => new Set(enabledClassNames || []),
    [enabledClassNames],
  );
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [instances, setInstances] = useState<any[]>([]);
  const [selected, setSelected] = useState<string>("__overview__");

  useEffect(() => {
    if (!open || !requestId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("drawing_instances" as any)
        .select("id, awp_class_name, file_id, page_index, instance_number, nx, ny, created_at")
        .eq("analysis_request_id", requestId)
        .order("awp_class_name")
        .order("created_at", { ascending: true });
      if (!cancelled) {
        setInstances((data as any[]) || []);
        setLoading(false);
        setSelected("__overview__");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, requestId]);

  const fileNameById = useMemo(
    () => new Map(fileGroups.map((g) => [g.file.id, g.file.name])),
    [fileGroups],
  );

  // sheet lookup: "fileName::pageIndex" -> { sheet, file }
  const sheetByFilePage = useMemo(() => {
    const m = new Map<string, { sheet: SheetRow; file: FileRow }>();
    for (const g of fileGroups) {
      for (const s of g.sheets) {
        m.set(`${g.file.name}::${s.page_index}`, { sheet: s, file: g.file });
      }
    }
    return m;
  }, [fileGroups]);

  // space_index map for proper sorting (P2 Sub-Slab < P2 < P1 < Ground < L1 ...)
  const spaceIndexMap = useMemo(() => {
    const m = new Map<string, number>();
    const parsed: any = spaceHierarchyPayload?.parsed;
    const spaces: any[] = parsed?.physical_spaces || parsed?.spatial_records || [];
    for (const sp of spaces) {
      if (sp?.standardized_space_name && typeof sp?.space_index === "number") {
        m.set(sp.standardized_space_name, sp.space_index);
      }
    }
    return m;
  }, [spaceHierarchyPayload]);

  // Map annotation id -> consolidation group it belongs to (if any).
  const consolidationByAnnId = useMemo(() => {
    const m = new Map<string, { label: string; className: string; groupKey: string }>();
    for (const c of consolidations || []) {
      const groupKey = `${c.awp_class_name}::${c.id}`;
      for (const annId of c.member_annotation_ids || []) {
        m.set(annId, { label: c.label, className: c.awp_class_name, groupKey });
      }
    }
    return m;
  }, [consolidations]);

  // Resolve per-page (level, unit?) pairs. Falls back to the legacy level-only
  // map when spatial_records lacks unit_templates (older projects).
  const pairsForPage = (fileName: string, pageIndex: number): Array<{ level: string; unit?: string }> => {
    const key = `${fileName}::${pageIndex}`;
    const unitAware = pageSpaceUnitMap.get(key);
    if (unitAware && unitAware.length > 0) return unitAware;
    const levels = pageSpaceMap.get(key) || [];
    return levels.map((l) => ({ level: l }));
  };

  // Encode an (level, unit?) suffix safely. Spaces -> "_". The "::" separator
  // is reserved between level and unit, so any "::" inside the level/unit
  // labels themselves is stripped to avoid ambiguity if anything ever splits.
  const encodeSuffix = (level: string, unit?: string): string => {
    const lvl = level.replace(/\s+/g, "_").replace(/::/g, "_");
    if (!unit) return lvl;
    const u = unit.replace(/\s+/g, "_").replace(/::/g, "_");
    return `${lvl}::${u}`;
  };

  const expanded = useMemo(() => {
    type Row = {
      annotationBaseId: string;
      instanceId: string;
      spaceName: string | null;
      unitName: string | null;
      awpClassName: string;
      category: string;
      fileId: string;
      pageIndex: number;
      nx: number;
      ny: number;
      // Stable key per logical instance — used to de-duplicate the same
      // consolidated riser appearing across multiple pages. For unit-expanded
      // rows, the (level, unit) pair is folded into the key so each
      // (level, unit) expansion counts as its own logical instance.
      logicalKey: string;
    };
    const rows: Row[] = [];

    // Bucket consolidated members so we emit one row per (group, level, unit?).
    const groupedMembers = new Map<string, any[]>();
    for (const inst of instances) {
      if (enabledClassSet.size > 0 && !enabledClassSet.has(inst.awp_class_name)) continue;
      const cg = consolidationByAnnId.get(inst.id);
      if (cg) {
        const list = groupedMembers.get(cg.groupKey) || [];
        list.push(inst);
        groupedMembers.set(cg.groupKey, list);
        continue; // emit later as a single consolidated instance
      }
      const opt = optionByName.get(inst.awp_class_name);
      const prefix = opt?.idPrefix || inst.awp_class_name.slice(0, 3).toUpperCase();
      const category = opt?.category || "Other";
      const num = inst.instance_number ?? 0;
      const base = `${prefix}${String(num).padStart(3, "0")}`;
      const fileName = fileNameById.get(inst.file_id) || "";
      const pairs = pairsForPage(fileName, inst.page_index);
      const common = {
        annotationBaseId: base,
        awpClassName: inst.awp_class_name,
        category,
        fileId: inst.file_id,
        pageIndex: inst.page_index,
        nx: Number(inst.nx) || 0,
        ny: Number(inst.ny) || 0,
      };
      if (pairs.length === 0) {
        rows.push({
          ...common,
          instanceId: base,
          spaceName: null,
          unitName: null,
          logicalKey: `ann::${inst.id}`,
        });
      } else {
        for (const p of pairs) {
          rows.push({
            ...common,
            instanceId: `${base}@${encodeSuffix(p.level, p.unit)}`,
            spaceName: p.level,
            unitName: p.unit ?? null,
            // Each (level, unit) expansion is its own logical instance, so an
            // annotation on a unit plan that applies to 16 levels counts 16x.
            logicalKey: `ann::${inst.id}::${p.level}::${p.unit ?? ""}`,
          });
        }
      }
    }

    // Emit consolidated groups: one row per (group, level, unit?) using ANY
    // member annotation as the on-drawing anchor for that pair.
    for (const [groupKey, members] of groupedMembers) {
      if (members.length === 0) continue;
      const first = members[0];
      const opt = optionByName.get(first.awp_class_name);
      const category = opt?.category || "Other";
      const cg = consolidationByAnnId.get(first.id)!;
      // For each unique (level, unit?) across all members, pick the member
      // that lives there (so the drawing overlay anchors to that page).
      const pairToMember = new Map<string, { member: any; pair: { level: string; unit?: string } }>();
      const unassignedMembers: any[] = [];
      for (const m of members) {
        const fname = fileNameById.get(m.file_id) || "";
        const pairs = pairsForPage(fname, m.page_index);
        if (pairs.length === 0) {
          unassignedMembers.push(m);
        } else {
          for (const p of pairs) {
            const k = `${p.level}::${p.unit ?? ""}`;
            if (!pairToMember.has(k)) pairToMember.set(k, { member: m, pair: p });
          }
        }
      }
      if (pairToMember.size === 0 && unassignedMembers.length === 0) continue;
      if (pairToMember.size === 0) {
        const m = unassignedMembers[0];
        rows.push({
          annotationBaseId: cg.label,
          instanceId: cg.label,
          spaceName: null,
          unitName: null,
          awpClassName: first.awp_class_name,
          category,
          fileId: m.file_id,
          pageIndex: m.page_index,
          nx: Number(m.nx) || 0,
          ny: Number(m.ny) || 0,
          logicalKey: `cons::${groupKey}`,
        });
      } else {
        for (const [k, { member, pair }] of pairToMember) {
          rows.push({
            annotationBaseId: cg.label,
            instanceId: cg.label,
            spaceName: pair.level,
            unitName: pair.unit ?? null,
            awpClassName: first.awp_class_name,
            category,
            fileId: member.file_id,
            pageIndex: member.page_index,
            nx: Number(member.nx) || 0,
            ny: Number(member.ny) || 0,
            logicalKey: `cons::${groupKey}::${k}`,
          });
        }
      }
    }

    return rows;
  }, [instances, optionByName, fileNameById, pageSpaceMap, pageSpaceUnitMap, enabledClassSet, consolidationByAnnId]);


  const spaceList = useMemo(() => {
    const set = new Set<string>();
    // Start from the full hierarchy so spaces with 0 detections still appear.
    const _p: any = spaceHierarchyPayload?.parsed;
    const hierarchySpaces: any[] = _p?.physical_spaces || _p?.spatial_records || [];
    for (const sp of hierarchySpaces) {
      if (sp?.standardized_space_name) set.add(sp.standardized_space_name);
    }
    let hasUnassigned = false;
    for (const r of expanded) {
      if (r.spaceName) set.add(r.spaceName);
      else hasUnassigned = true;
    }
    const arr = Array.from(set).sort((a, b) => {
      const ia = spaceIndexMap.get(a);
      const ib = spaceIndexMap.get(b);
      if (ia !== undefined && ib !== undefined) return ia - ib;
      if (ia !== undefined) return -1;
      if (ib !== undefined) return 1;
      return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
    });
    if (hasUnassigned) arr.push("__unassigned__");
    return arr;
  }, [expanded, spaceIndexMap, spaceHierarchyPayload]);

  const classCols = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of expanded) {
      if (r.category === "Asset" || r.category === "Water System") {
        map.set(r.awpClassName, r.category);
      }
    }
    return Array.from(map.entries())
      .sort((a, b) => {
        if (a[1] !== b[1]) return a[1] === "Asset" ? -1 : 1;
        return a[0].localeCompare(b[0]);
      })
      .map(([name, category]) => ({ name, category }));
  }, [expanded]);

  const overviewTotals = useMemo(() => {
    const m = new Map<string, number>();
    const seenConsolidated = new Set<string>();
    for (const r of expanded) {
      if (r.category !== "Asset" && r.category !== "Water System") continue;
      // Each consolidated logical instance counts once; each plain annotation
      // counts per row (preserves existing per-space counting behavior).
      if (r.logicalKey.startsWith("cons::")) {
        if (seenConsolidated.has(r.logicalKey)) continue;
        seenConsolidated.add(r.logicalKey);
      }
      m.set(r.awpClassName, (m.get(r.awpClassName) || 0) + 1);
    }
    return m;
  }, [expanded]);

  const summaryMatrix = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    for (const r of expanded) {
      if (r.category !== "Asset" && r.category !== "Water System") continue;
      const space = r.spaceName ?? "__unassigned__";
      const inner = m.get(space) || new Map<string, number>();
      inner.set(r.awpClassName, (inner.get(r.awpClassName) || 0) + 1);
      m.set(space, inner);
    }
    return m;
  }, [expanded]);

  const instancesForSpace = (space: string) =>
    expanded
      .filter((r) => (space === "__unassigned__" ? r.spaceName === null : r.spaceName === space))
      .sort((a, b) => {
        // Sort by base instance ID first, then by unit name (numeric-aware).
        const baseCmp = a.annotationBaseId.localeCompare(b.annotationBaseId, undefined, { numeric: true, sensitivity: "base" });
        if (baseCmp !== 0) return baseCmp;
        const ua = a.unitName ?? "";
        const ub = b.unitName ?? "";
        return ua.localeCompare(ub, undefined, { numeric: true, sensitivity: "base" });
      });


  // Compact table density classes (reduce row heights)
  const compactRow = "h-7";
  const compactCell = "py-1 text-xs";
  const compactHead = "h-7 py-1 text-xs";

  const renderOverview = () => {
    const sourceDrawings = fileGroups.map((g) => g.file.name).join("; ") || "—";
    const today = new Date();
    const reportDate = today.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold mb-2">Report Overview</h2>
          <p className="text-sm text-muted-foreground mb-4">
            RiskBlue reviewed the referenced drawing sheets to identify assets and water systems at
            risk across spaces for the {projectName} project. The report summarizes detected items
            and provides space-by-space occurrence tables paired with the corresponding drawing
            views.
          </p>
          <Table>
            <TableBody>
              {[
                ["Project", projectName],
                ["Report Type", "Workbench Drawing Analysis"],
                ["Prepared By", "RiskBlue"],
                ["Report Date", reportDate],
                ["Document Version", "V1"],
                ["Source Drawings", sourceDrawings],
              ].map(([label, value]) => (
                <TableRow key={label} className={compactRow}>
                  <TableCell
                    className={`${compactCell} font-semibold bg-muted/40 w-[180px] align-top`}
                  >
                    {label}
                  </TableCell>
                  <TableCell className={`${compactCell} align-top`}>{value}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div>
          <h3 className="text-base font-bold mb-2">Assets at Risk Detections</h3>
          {classCols.length === 0 ? (
            <div className="text-sm text-muted-foreground">No detections yet.</div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
              {classCols.map((c) => {
                const prefix = optionByName.get(c.name)?.idPrefix || c.name.slice(0, 3).toUpperCase();
                return (
                  <div
                    key={c.name}
                    className="border rounded overflow-hidden text-center"
                  >
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="bg-sky-900 text-white text-xs font-semibold py-1 cursor-help">
                          {prefix}
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>{c.name}</TooltipContent>
                    </Tooltip>
                    <div className="py-2 text-2xl font-bold text-sky-700 tabular-nums">
                      {overviewTotals.get(c.name) || 0}
                    </div>
                    <div className="text-[11px] text-muted-foreground pb-2 px-1">{c.name}</div>
                  </div>
                );
              })}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground mt-2">
            Note: Detection totals are derived from the occurrence tables that follow. The
            per-space pages retain the original table + drawing evidence format.
          </p>
        </div>
      </div>
    );
  };

  const renderSummary = () => (
    <div>
      <h3 className="text-sm font-semibold mb-2">Summary (Counts per Space by Class)</h3>
      <div className="overflow-auto">
        <Table>
          <TableHeader>
            <TableRow className={compactRow}>
              <TableHead className={`${compactHead} sticky left-0 bg-background`}>Space</TableHead>
              {classCols.map((c) => (
                <TableHead
                  key={c.name}
                  className={`${compactHead} text-center whitespace-nowrap`}
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-help inline-block">
                        {optionByName.get(c.name)?.idPrefix || c.name}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{c.name}</TooltipContent>
                  </Tooltip>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {spaceList.map((space) => {
              const inner = summaryMatrix.get(space);
              const label = space === "__unassigned__" ? "Unassigned" : space;
              return (
                <TableRow key={space} className={compactRow}>
                  <TableCell
                    className={`${compactCell} sticky left-0 bg-background font-medium`}
                  >
                    {label}
                  </TableCell>
                  {classCols.map((c) => (
                    <TableCell key={c.name} className={`${compactCell} text-center tabular-nums`}>
                      {inner?.get(c.name) || 0}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );

  const renderSpaceDetail = (space: string) => {
    const rows = instancesForSpace(space);
    const label = space === "__unassigned__" ? "Unassigned" : space;
    // Group rows by file+page so we can render each matched drawing with overlays.
    const pageKeys = Array.from(
      new Set(rows.map((r) => `${r.fileId}::${r.pageIndex}`)),
    );
    const showUnitCol = rows.some((r) => !!r.unitName);
    return (
      <div className="space-y-4">
        <h3 className="text-sm font-semibold">{label}</h3>
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-background shadow-[0_1px_0_0_hsl(var(--border))]">
            <TableRow className={compactRow}>
              <TableHead className={compactHead}>Instance ID</TableHead>
              <TableHead className={compactHead}>Class</TableHead>
              {showUnitCol && <TableHead className={compactHead}>Unit</TableHead>}
              <TableHead className={compactHead}>Annotation ID</TableHead>
              <TableHead className={compactHead}>Source</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={`${r.instanceId}-${i}`} className={compactRow}>
                <TableCell className={`${compactCell} font-mono`}>{r.instanceId}</TableCell>
                <TableCell className={compactCell}>{r.awpClassName}</TableCell>
                {showUnitCol && (
                  <TableCell className={compactCell}>{r.unitName ?? "—"}</TableCell>
                )}
                <TableCell className={`${compactCell} font-mono text-muted-foreground`}>
                  {r.annotationBaseId}
                </TableCell>
                <TableCell className={`${compactCell} text-muted-foreground`}>
                  {fileNameById.get(r.fileId)} · Page {r.pageIndex}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div className="space-y-6">
          {pageKeys.map((key) => {
            const [fileId, pageIdxStr] = key.split("::");
            const pageIdx = parseInt(pageIdxStr, 10);
            const fileName = fileNameById.get(fileId) || "";
            const lookup = sheetByFilePage.get(`${fileName}::${pageIdx}`);
            if (!lookup || !lookup.sheet.storage_path) {
              return (
                <div key={key} className="text-xs text-muted-foreground">
                  {fileName} · Page {pageIdx} (drawing not available)
                </div>
              );
            }
            const source: DocumentSourceDescriptor = {
              kind: "supabase-storage",
              bucket: bucketForSource(lookup.sheet.file_source_type),
              path: lookup.sheet.storage_path,
              mimeType: "application/pdf",
            };
            // Sheet storage_path is a per-page rendered PDF (single page),
            // so overlays and the viewer must address page 1, not the
            // original page_index from the source document.
            const overlays = rows
              .filter((r) => r.fileId === fileId && r.pageIndex === pageIdx)
              .map((r, i) => ({
                id: `${r.instanceId}-${i}`,
                bbox: [r.nx, r.ny, 0, 0] as [number, number, number, number],
                coordSpace: "normalized" as const,
                page: 1,
                color: awpClassColor(r.awpClassName),
                label: r.instanceId,
                shape: "circle" as const,
              }));

            return (
              <DrawingPageBlock
                key={key}
                fileName={fileName}
                pageIdx={pageIdx}
                source={source}
                overlays={overlays}
              />
            );
          })}
        </div>
      </div>
    );
  };

  const renderRight = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center p-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      );
    }
    if (selected === "__overview__") return renderOverview();
    if (expanded.length === 0) {
      return (
        <div className="text-sm text-muted-foreground p-4">
          No annotations found. Place annotations on drawings first.
        </div>
      );
    }
    if (selected === "__summary__") return renderSummary();
    return renderSpaceDetail(selected);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[95vw] sm:max-w-[95vw]">
        <DialogHeader>
          <DialogTitle>Threat Report</DialogTitle>
          <DialogDescription>
            Annotations expanded into per-space instance IDs. Unit floor-plan detections are expanded once per level the unit applies to (e.g. WS001@L05::UnitA).

          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-[220px_1fr] gap-4 max-h-[70vh]">
          <div className="border rounded-md overflow-auto">
            <button
              type="button"
              onClick={() => setSelected("__overview__")}
              className={`w-full text-left px-3 py-2 text-sm border-b hover:bg-muted/40 ${
                selected === "__overview__" ? "bg-muted font-medium" : ""
              }`}
            >
              Overview
            </button>
            <button
              type="button"
              onClick={() => setSelected("__summary__")}
              className={`w-full text-left px-3 py-2 text-sm border-b hover:bg-muted/40 ${
                selected === "__summary__" ? "bg-muted font-medium" : ""
              }`}
            >
              Summary
            </button>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-3 py-2 border-b bg-muted/20">
              Spaces
            </div>
            {spaceList.map((space) => {
              const label = space === "__unassigned__" ? "Unassigned" : space;
              return (
                <button
                  key={space}
                  type="button"
                  onClick={() => setSelected(space)}
                  className={`w-full text-left px-3 py-2 text-sm border-b hover:bg-muted/40 ${
                    selected === space ? "bg-muted font-medium" : ""
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div className="overflow-auto pr-1">{renderRight()}</div>
        </div>
        <DialogFooter className="flex flex-row sm:justify-between gap-2">
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() =>
                toast({
                  title: "Export queued",
                  description: "You'll receive an email with the results.",
                })
              }
            >
              Export Report
            </Button>
            <Button
              onClick={() =>
                toast({
                  title: "Sent to WMG Project",
                  description: "Results have been sent.",
                })
              }
            >
              Send to WMG Project
            </Button>
          </div>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// DrawingPageBlock — renders a single drawing page in the Instances Report
// with a docked header (file name + Download button) and a non-interactive
// DrawingViewer. The Download button rasterizes the page (including markers)
// to PNG via html2canvas.
// ---------------------------------------------------------------------------
function DrawingPageBlock({
  fileName,
  pageIdx,
  source,
  overlays,
}: {
  fileName: string;
  pageIdx: number;
  source: DocumentSourceDescriptor;
  overlays: any[];
}) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    const el = surfaceRef.current;
    if (!el) return;
    setDownloading(true);
    try {
      // Locate page image and the overlay layer.
      const pageImg = el.querySelector("img") as HTMLImageElement | null;
      if (!pageImg) throw new Error("Drawing not yet loaded.");
      const imgRect = pageImg.getBoundingClientRect();
      const cssW = pageImg.clientWidth;
      const cssH = pageImg.clientHeight;
      if (!cssW || !cssH) throw new Error("Drawing not yet loaded.");

      // Output canvas at 2x for crispness.
      const outScale = 2;
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(cssW * outScale);
      canvas.height = Math.round(cssH * outScale);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";

      // Reload image to bypass any tainted decode state.
      const sourceImg: HTMLImageElement = await new Promise((resolve, reject) => {
        const im = new Image();
        im.crossOrigin = "anonymous";
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error("Could not load page image."));
        im.src = pageImg.src;
      });
      ctx.drawImage(sourceImg, 0, 0, canvas.width, canvas.height);

      const px = (v: number) => v * outScale;
      const toLocal = (clientX: number, clientY: number) => ({
        x: (clientX - imgRect.left) * outScale,
        y: (clientY - imgRect.top) * outScale,
      });

      // Leader lines (SVG). Convert SVG-local coords via getBoundingClientRect.
      const leaderLines = el.querySelectorAll<SVGLineElement>('line[data-export-kind="leader"]');
      leaderLines.forEach((line) => {
        const color = line.getAttribute("data-color") || "#dc2626";
        const opacity = Number(line.getAttribute("data-opacity") || "0.7");
        // Use CTM to map SVG coords to client coords.
        const svg = line.ownerSVGElement;
        if (!svg) return;
        const ctm = svg.getScreenCTM();
        if (!ctm) return;
        const pt1 = svg.createSVGPoint();
        pt1.x = Number(line.getAttribute("x1") || 0);
        pt1.y = Number(line.getAttribute("y1") || 0);
        const pt2 = svg.createSVGPoint();
        pt2.x = Number(line.getAttribute("x2") || 0);
        pt2.y = Number(line.getAttribute("y2") || 0);
        const p1 = pt1.matrixTransform(ctm);
        const p2 = pt2.matrixTransform(ctm);
        const a = toLocal(p1.x, p1.y);
        const b = toLocal(p2.x, p2.y);
        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5 * outScale;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.restore();
      });

      // Circles.
      const circles = el.querySelectorAll<HTMLDivElement>('[data-export-kind="circle"]');
      circles.forEach((div) => {
        const r = div.getBoundingClientRect();
        const center = toLocal(r.left + r.width / 2, r.top + r.height / 2);
        const radius = (r.width / 2) * outScale;
        const color = div.getAttribute("data-color") || "#dc2626";
        ctx.save();
        // Fill (translucent), then white halo, then colored border.
        ctx.beginPath();
        ctx.arc(center.x, center.y, radius - 1.25 * outScale, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.35;
        ctx.fill();
        ctx.globalAlpha = 1;
        // White halo.
        ctx.beginPath();
        ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
        ctx.lineWidth = 1 * outScale;
        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.stroke();
        // Colored border.
        ctx.beginPath();
        ctx.arc(center.x, center.y, radius - 1.25 * outScale, 0, Math.PI * 2);
        ctx.lineWidth = 2.5 * outScale;
        ctx.strokeStyle = color;
        ctx.stroke();
        ctx.restore();
      });

      // Labels: rect + text. Render each label fully opaque on an offscreen
      // canvas, then composite at the configured opacity so text doesn't get
      // double-faded by the background alpha (matches CSS group-opacity).
      const labels = el.querySelectorAll<HTMLDivElement>('[data-export-kind="label"]');
      labels.forEach((div) => {
        const r = div.getBoundingClientRect();
        const tl = toLocal(r.left, r.top);
        const w = r.width * outScale;
        const h = r.height * outScale;
        const bg = div.getAttribute("data-color") || "#dc2626";
        const textColor = div.getAttribute("data-text-color") || "#ffffff";
        const fontPx = Number(div.getAttribute("data-font-px") || "11") * outScale;
        const opacity = Number(div.getAttribute("data-opacity") || "0.7");
        const text = (div.textContent || "").trim();

        // Offscreen canvas at the label size.
        const off = document.createElement("canvas");
        off.width = Math.ceil(w);
        off.height = Math.ceil(h);
        const octx = off.getContext("2d")!;
        const radius = 3 * outScale;
        octx.beginPath();
        octx.moveTo(radius, 0);
        octx.lineTo(w - radius, 0);
        octx.quadraticCurveTo(w, 0, w, radius);
        octx.lineTo(w, h - radius);
        octx.quadraticCurveTo(w, h, w - radius, h);
        octx.lineTo(radius, h);
        octx.quadraticCurveTo(0, h, 0, h - radius);
        octx.lineTo(0, radius);
        octx.quadraticCurveTo(0, 0, radius, 0);
        octx.closePath();
        octx.fillStyle = bg;
        octx.fill();
        octx.lineWidth = 1 * outScale;
        octx.strokeStyle = "rgba(255,255,255,0.9)";
        octx.stroke();
        octx.fillStyle = textColor;
        octx.font = `bold ${fontPx}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
        octx.textAlign = "center";
        octx.textBaseline = "middle";
        octx.fillText(text, w / 2, h / 2);

        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.drawImage(off, tl.x, tl.y);
        ctx.restore();
      });


      const link = document.createElement("a");
      const safeName = `${fileName.replace(/\.[^.]+$/, "")}_page${pageIdx}.png`;
      link.download = safeName;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch (err) {
      toast({
        title: "Download failed",
        description: (err as any)?.message ?? "Could not capture drawing.",
        variant: "destructive",
      });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="border rounded-md overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-muted/40 border-b">
        <div className="text-sm font-semibold truncate">
          {fileName} · Page {pageIdx}
        </div>
        <Button size="sm" variant="outline" onClick={handleDownload} disabled={downloading}>
          {downloading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
          ) : (
            <Download className="h-3.5 w-3.5 mr-1.5" />
          )}
          Download
        </Button>
      </div>
      <div ref={surfaceRef} className="w-full aspect-[3/2] bg-white">
        <DrawingViewer
          source={source}
          page={1}
          overlays={overlays}
          showToolbar={false}
          interactive={false}
        />
      </div>
    </div>
  );
}
