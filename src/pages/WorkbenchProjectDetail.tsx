import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Loader2,
  MoreVertical,
  Trash2,
  Settings2,
  ShieldAlert,
  Square,
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
import { Input } from "@/components/ui/input";
import { useActivityLogger } from "@/hooks/useActivityLogger";
import { SpaceEditModal } from "@/components/workbench/SpaceEditModal";
import { ConsolidateRisersModal } from "@/components/workbench/ConsolidateRisersModal";
import { SpatialArchitectModal } from "@/components/workbench/SpatialArchitectModal";
import { normalizeScoutResponse } from "@/lib/scoutResponseNormalizer";
import {
  runThreatReportExport,
  type ExportProgress,
  type ThreatReportPayload,
  type ThreatReportPageRef,
  type ThreatReportSpace,
} from "@/lib/threatReportExport";

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

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  parseSurveyFloorPlans,
  floorPlanDisplayLabel,
  getAddedUnitPlans,
  addedUnitPlanToParsed,
  makeAddedUnitPlanId,
  ADDED_UNIT_PLANS_KEY,
  DELETED_PLAN_IDS_KEY,
  getDeletedPlanIds,
  getEffectiveBbox,
  getEffectiveLabel,
  getEffectiveType,
  unitPlanRefKey,
  type ParsedFloorPlan,
} from "@/lib/surveyFloorPlans";

import { DrawingViewer } from "@/components/viewer";
import {
  prewarmDocumentSource,
  resolveDocumentSource,
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
  /** Size in bytes — used as a cache-busting version token for the shared
   * document cache. Changes when the underlying object is replaced. */
  size_bytes?: number | null;
  survey_raw_response?: string | null;
  survey_raw_updated_at?: string | null;
  risk_element_results?: Record<string, any> | null;
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
  /** Sheet updated_at — used as the shared cache version token. */
  updated_at?: string | null;
  survey_result?: unknown;
  survey_updated_at?: string | null;
  floor_plan_overrides?: Record<string, any> | null;
}

function isValidPctBbox(v: unknown): v is [number, number, number, number] {
  return Array.isArray(v) && v.length === 4 && v.every((n) => Number.isFinite(n));
}

function materializeFloorPlan(
  plan: ParsedFloorPlan,
  overrides: Record<string, any> | null | undefined,
): ParsedFloorPlan {
  return {
    ...plan,
    type: getEffectiveType(plan, overrides),
    reference_id: getEffectiveLabel(plan, overrides) || plan.reference_id,
    xy_width_height_pct: getEffectiveBbox(plan, overrides),
  };
}

function overrideOnlyFloorPlans(
  overrides: Record<string, any> | null | undefined,
  page: number,
  knownIds: Set<string>,
  deletedIds: Set<string>,
): ParsedFloorPlan[] {
  if (!overrides) return [];
  const out: ParsedFloorPlan[] = [];
  for (const [planId, raw] of Object.entries(overrides)) {
    if (planId.startsWith("__") || knownIds.has(planId) || deletedIds.has(planId)) continue;
    const ovr = raw as any;
    const type = typeof ovr?.type === "string" && ovr.type ? ovr.type : null;
    const name = typeof ovr?.name === "string" && ovr.name.trim() ? ovr.name.trim() : null;
    const bbox = isValidPctBbox(ovr?.bbox_pct) ? ovr.bbox_pct : null;
    if (!type && !name && !bbox) continue;
    out.push({
      plan_id: planId,
      type: type || "level_floor_plan",
      reference_id: name || planId,
      xy_width_height_pct: bbox,
      page_number: page,
      floors: [],
      referenced_unit_ids: [],
    });
  }
  return out;
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

/** Format a set of space names into a single label.
 *  - "Level 13"                          → "Level 13"
 *  - ["Level 13".."Level 57"]            → "Levels 13 - 57"
 *  - ["Level 4","Level 5","Level 12".."Level 17"] → "Levels 4, 5, 12 - 17"
 *  - Non-numeric names pass through (e.g. "Ground Level"). */
function formatLevelSetLabel(spaces: string[]): string {
  if (!spaces || spaces.length === 0) return "";
  const nums: number[] = [];
  const others: string[] = [];
  for (const s of spaces) {
    const m = /^Level\s+(-?\d+)$/.exec(s);
    if (m) nums.push(parseInt(m[1], 10));
    else others.push(s);
  }
  const out: string[] = [];
  if (nums.length) {
    const sorted = Array.from(new Set(nums)).sort((a, b) => a - b);
    const runs: Array<[number, number]> = [];
    let start = sorted[0];
    let prev = sorted[0];
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] === prev + 1) { prev = sorted[i]; continue; }
      runs.push([start, prev]);
      start = prev = sorted[i];
    }
    runs.push([start, prev]);
    const chunks = runs.map(([a, b]) => (a === b ? `${a}` : `${a} - ${b}`));
    const hasRange = runs.some(([a, b]) => a !== b);
    const prefix = sorted.length > 1 || hasRange ? "Levels" : "Level";
    out.push(`${prefix} ${chunks.join(", ")}`);
  }
  if (others.length) out.push(others.join(", "));
  return out.join(", ");
}

/** Sheet-level fallback: returns a single chip's worth of label. */
function groupSpaceLabels(spaces: string[]): string[] {
  const label = formatLevelSetLabel(spaces);
  return label ? [label] : [];
}

function formatSpaceBadge(spaces: string[]): string {
  return formatLevelSetLabel(spaces);
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "-";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  const rs = Math.round(s - m * 60);
  return `${m}m${rs.toString().padStart(2, "0")}s`;
}

export default function WorkbenchProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>();
  const { user, session } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { logActivity } = useActivityLogger();
  const isInternal = user?.email?.toLowerCase().endsWith("@riskclock.com") ?? false;

  const [activeSheet, setActiveSheet] = useState<SheetRow | null>(null);
  const [activeFile, setActiveFile] = useState<FileRow | null>(null);
  const [preselectClass, setPreselectClass] = useState<string | null>(null);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [cleanupChecked, setCleanupChecked] = useState<Set<string>>(new Set());
  const [cleanupRunning, setCleanupRunning] = useState(false);

  
  const [manageOpen, setManageOpen] = useState(false);
  const [draftCols, setDraftCols] = useState<string[]>([]);
  const [draftAliases, setDraftAliases] = useState<Record<string, string>>({});
  const [draftAliasPrefixes, setDraftAliasPrefixes] = useState<Record<string, string>>({});
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [textFileId, setTextFileId] = useState<string | null>(null);
  const [textSheet, setTextSheet] = useState<{ id: string; label: string } | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  // Typed-confirmation state for destructive Clear All when manual data exists.
  const [clearConfirmText, setClearConfirmText] = useState("");
  // Pre-flight counts of what Clear All will destroy, fetched when the dialog opens.
  const [clearCounts, setClearCounts] = useState<{
    drawing_instances: number;
    annotation_consolidations: number;
    manual_floor_plans: number;
    surveyed_files: number;
    loading: boolean;
  } | null>(null);
  // Typed-confirmation state for Scout re-run over existing survey data.
  const [scoutConfirmOpen, setScoutConfirmOpen] = useState(false);
  const [scoutConfirmText, setScoutConfirmText] = useState("");
  const scoutRerunAfterConfirmRef = useRef<null | (() => void)>(null);
  // One-shot bypass flag set by the confirm dialog so the re-click doesn't
  // re-open the same dialog. Consumed on the next Scout onClick.
  const scoutBypassConfirmRef = useRef(false);
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
  const [surveyResponseModal, setSurveyResponseModal] = useState<{ fileName: string; raw: string; label?: string } | null>(null);
  const [scoutDebugOpen, setScoutDebugOpen] = useState(false);

  const [spaceModalOpen, setSpaceModalOpen] = useState(false);
  const [buildingSpace, setBuildingSpace] = useState(false);
  const [spatialArchitectOpen, setSpatialArchitectOpen] = useState(false);
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
  const [riskRadarModalOpen, setRiskRadarModalOpen] = useState(false);
  const [riskRadarSelection, setRiskRadarSelection] = useState<Set<string>>(new Set());
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
    /** Bytes — cache-busting version token for the shared document cache. */
    size_bytes?: number | null;
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
      version: activePageView.file.size_bytes ?? undefined,
    };
  }, [activePageView]);

  // Debounced hover-triggered prefetch for drawing rows. Fires after ~150ms
  // of dwell so quick mouse-sweeps don't kick off dozens of PDF downloads.
  // Cancelled on mouseleave. The actual fetch is a no-op when the target
  // blob is already in the shared cache (memory or IndexedDB).
  const hoverPrefetchTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  useEffect(() => {
    const timers = hoverPrefetchTimers.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);
  const handleRowHoverStart = useCallback(
    (row: { id: string; storage_path: string | null; source_type: string; mime_type: string | null; size_bytes?: number | null }) => {
      if (!row.storage_path) return;
      const timers = hoverPrefetchTimers.current;
      if (timers.has(row.id)) return;
      const timer = setTimeout(() => {
        timers.delete(row.id);
        void prewarmDocumentSource({
          kind: "supabase-storage",
          bucket: bucketForSource(row.source_type),
          path: row.storage_path!,
          mimeType: row.mime_type || "application/pdf",
          version: row.size_bytes ?? undefined,
        });
      }, 150);
      timers.set(row.id, timer);
    },
    [],
  );
  const handleRowHoverEnd = useCallback((rowId: string) => {
    const timers = hoverPrefetchTimers.current;
    const t = timers.get(rowId);
    if (t) {
      clearTimeout(t);
      timers.delete(rowId);
    }
  }, []);

  // ---------------------------------------------------------------
  // Floor-plan data for the activePageView modal (single-page modal)
  // ---------------------------------------------------------------
  const [activeFileSurveyRaw, setActiveFileSurveyRaw] = useState<string | null>(null);
  const [activeSheetIdForPage, setActiveSheetIdForPage] = useState<string | null>(null);
  const [activeFloorPlanOverrides, setActiveFloorPlanOverrides] = useState<
    Record<string, any>
  >({});
  const [activeFileRiskClasses, setActiveFileRiskClasses] = useState<string[]>([]);
  // Holds the current request id so async effects declared above the
  // analysisRequest query can read it without a forward reference.
  const requestIdRef = useRef<string | null>(null);

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

      let sheetId = (sheetRes.data as any)?.id ?? null;
      let overrides = (sheetRes.data as any)?.floor_plan_overrides;
      // Lazily create a sheet row so the user can place floor-plan boxes
      // before Scout runs (Scout upserts on the same (file, page) pair).
      const reqId = requestIdRef.current;
      if (!sheetId && reqId) {
        const fileName = activePageView.file.name || "file";
        const { data: created, error: createErr } = await supabase
          .from("analysis_request_sheets")
          .upsert(
            {
              analysis_request_id: reqId,
              parent_file_id: fileId,
              page_index: page,
              name: `${fileName} · page ${page}`,
              extract_status: "skipped",
            } as any,
            { onConflict: "parent_file_id,page_index" },
          )
          .select("id, floor_plan_overrides")
          .maybeSingle();
        if (cancelled) return;
        if (!createErr && created) {
          sheetId = (created as any).id;
          overrides = (created as any).floor_plan_overrides;
        }
      }
      setActiveSheetIdForPage(sheetId);
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
    const baseRaw = (activeFileFloorPlansByPage.get(activePageView.page) ?? []).filter(
      (fp) => !deleted.has(fp.plan_id),
    );
    const addedRaw = getAddedUnitPlans(activeFloorPlanOverrides, activePageView.page)
      .filter((e) => !deleted.has(e.plan_id));
    const knownIds = new Set<string>([
      ...baseRaw.map((fp) => fp.plan_id),
      ...addedRaw.map((fp) => fp.plan_id),
    ]);
    const base = baseRaw.map((fp) => materializeFloorPlan(fp, activeFloorPlanOverrides));
    const added = addedRaw
      .map(addedUnitPlanToParsed)
      .map((fp) => materializeFloorPlan(fp, activeFloorPlanOverrides));
    const overrideOnly = overrideOnlyFloorPlans(
      activeFloorPlanOverrides,
      activePageView.page,
      knownIds,
      deleted,
    );
    return [...base, ...added, ...overrideOnly];
  }, [activeFileFloorPlansByPage, activePageView, activeFloorPlanOverrides]);

  // NOTE: `activeFileAllUnitPlans` is declared later (after `rows`) so it can
  // merge added-unit-plan entries persisted in other sheets of the same file.



  // `activeFileAllLevelPlans` is declared later (after `rows`) so it can merge
  // added level-plan entries persisted in other sheets of the same file.



  // File-wide level-plan overrides (units arrays) are computed after the
  // `rows` query is declared below - see `activeFileAllLevelPlanOverrides`.




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
  useEffect(() => {
    requestIdRef.current = requestId ?? null;
  }, [requestId]);

  // Per-project AWP class display aliases. Alias replaces the canonical
  // class name in headers, tooltips, and the Threat Report.
  const [aliasMap, setAliasMap] = useState<Record<string, string>>({});
  const [aliasPrefixMap, setAliasPrefixMap] = useState<Record<string, string>>({});
  
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("project_class_aliases" as any)
        .select("awp_class_name, alias, alias_prefix")
        .eq("project_id", projectId);
      if (cancelled || error || !data) return;
      const nameMap: Record<string, string> = {};
      const prefixMap: Record<string, string> = {};
      for (const r of data as any[]) {
        if (r?.alias) nameMap[r.awp_class_name] = r.alias as string;
        if (r?.alias_prefix) prefixMap[r.awp_class_name] = r.alias_prefix as string;
      }
      setAliasMap(nameMap);
      setAliasPrefixMap(prefixMap);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const displayClassName = useCallback(
    (name: string) => aliasMap[name] || name,
    [aliasMap],
  );

  const saveClassAlias = useCallback(
    async (awpClassName: string, alias: string, aliasPrefix: string) => {
      if (!projectId) return;
      // If both fields are empty, remove the row entirely.
      if (!alias && !aliasPrefix) {
        const { error } = await supabase
          .from("project_class_aliases" as any)
          .delete()
          .eq("project_id", projectId)
          .eq("awp_class_name", awpClassName);
        if (error) {
          toast({
            variant: "destructive",
            title: "Could not remove alias",
            description: getUserFriendlyError(error),
          });
          return;
        }
        setAliasMap((prev) => {
          const next = { ...prev };
          delete next[awpClassName];
          return next;
        });
        setAliasPrefixMap((prev) => {
          const next = { ...prev };
          delete next[awpClassName];
          return next;
        });
        return;
      }
      const { error } = await supabase
        .from("project_class_aliases" as any)
        .upsert(
          {
            project_id: projectId,
            awp_class_name: awpClassName,
            alias: alias || null,
            alias_prefix: aliasPrefix || null,
          },
          { onConflict: "project_id,awp_class_name" },
        );
      if (error) {
        toast({
          variant: "destructive",
          title: "Could not save alias",
          description: getUserFriendlyError(error),
        });
        return;
      }
      setAliasMap((prev) => {
        const next = { ...prev };
        if (alias) next[awpClassName] = alias;
        else delete next[awpClassName];
        return next;
      });
      setAliasPrefixMap((prev) => {
        const next = { ...prev };
        if (aliasPrefix) next[awpClassName] = aliasPrefix;
        else delete next[awpClassName];
        return next;
      });
    },
    [projectId, toast],
  );


  useEffect(() => {
    if (!projectId || requestId || pageInfoRows.length > 0) return;
    try {
      const cached = window.localStorage.getItem(`riskblue:workbench-page-info:project:${projectId}`);
      const parsed = cached ? JSON.parse(cached) : null;
      if (Array.isArray(parsed?.rows)) {
        const cachedRows = parsed.rows
          .filter((r: any) => r && typeof r.id === "string" && typeof r.name === "string")
          .map((r: any) => ({
            id: r.id,
            name: r.name,
            source_type: typeof r.source_type === "string" ? r.source_type : "manual_upload",
            storage_path: typeof r.storage_path === "string" ? r.storage_path : null,
            mime_type: typeof r.mime_type === "string" ? r.mime_type : null,
            // Only accept positive integers. `Number(null)` is 0 and `isFinite(0)` is true,
            // which used to poison the cache with `page_count: 0` and hide the expand icon.
            page_count:
              typeof r.page_count === "number" && Number.isFinite(r.page_count) && r.page_count > 0
                ? r.page_count
                : null,
          })) as PageInfoRow[];
        if (cachedRows.length > 0) setPageInfoRows(cachedRows);
      }
    } catch {
      /* ignore cache */
    }
  }, [projectId, requestId, pageInfoRows.length]);

  // Load Page Info: list files, fill missing page counts via pdf.js, cache to DB.
  // source_type lives on analysis_requests, not on analysis_request_files.
  const requestSourceType = (analysisRequest as any)?.source_type as string | undefined;
  useEffect(() => {
    if (!requestId || !requestSourceType) { setPageInfoRows([]); return; }
    let cancelled = false;
    const cacheKey = `riskblue:workbench-page-info:${requestId}`;
    const projectCacheKey = projectId ? `riskblue:workbench-page-info:project:${projectId}` : null;
    let hasCachedRows = false;
    const cachedPageCounts = new Map<string, number>();
    try {
      const cached = window.localStorage.getItem(cacheKey);
      const parsed = cached ? JSON.parse(cached) : null;
      if (Array.isArray(parsed?.rows)) {
        const cachedRows = parsed.rows
          .filter((r: any) => r && typeof r.id === "string" && typeof r.name === "string")
          .map((r: any) => ({
            id: r.id,
            name: r.name,
            source_type: requestSourceType,
            storage_path: typeof r.storage_path === "string" ? r.storage_path : null,
            mime_type: typeof r.mime_type === "string" ? r.mime_type : null,
            // Same null-cache guard as the project-level cache above - only trust
            // positive integers so a half-written cache entry can't stick as `0`.
            page_count:
              typeof r.page_count === "number" && Number.isFinite(r.page_count) && r.page_count > 0
                ? r.page_count
                : null,
          })) as PageInfoRow[];
        if (cachedRows.length > 0) {
          hasCachedRows = true;
          setPageInfoRows(cachedRows);
          for (const row of cachedRows) {
            if (row.page_count != null) cachedPageCounts.set(row.id, row.page_count);
          }
        }
      }
    } catch {
      /* ignore cache */
    }
    (async () => {
      setPageInfoLoading(!hasCachedRows);
      try {
        const { data, error } = await supabase
          .from("analysis_request_files")
          .select("id, name, storage_path, mime_type, size_bytes, expected_page_count")
          .eq("analysis_request_id", requestId)
          .order("name");
        if (error) throw error;
        const initial: PageInfoRow[] = ((data ?? []) as any[]).map((r) => ({
          id: r.id,
          name: r.name,
          source_type: requestSourceType,
          storage_path: r.storage_path,
          mime_type: r.mime_type,
          size_bytes: r.size_bytes ?? null,
          page_count: r.expected_page_count ?? cachedPageCounts.get(r.id) ?? null,
        }));
        if (cancelled) return;
        setPageInfoRows(initial);
        try {
          window.localStorage.setItem(cacheKey, JSON.stringify({ rows: initial, updatedAt: Date.now() }));
          if (projectCacheKey) window.localStorage.setItem(projectCacheKey, JSON.stringify({ rows: initial, updatedAt: Date.now() }));
        } catch {
          /* ignore cache */
        }

        const missing = initial.filter(
          (r) => r.page_count == null && r.storage_path && (r.mime_type ?? "application/pdf").includes("pdf"),
        );
        if (missing.length === 0) return;

        // Verify objects exist before signing to avoid 400 spam for orphans.
        const existsByRow = new Map<string, boolean>();
        const dirGroups = new Map<string, { bucket: string; dir: string; rows: typeof missing }>();
        for (const r of missing) {
          const bucket = bucketForSource(r.source_type);
          const path = r.storage_path!;
          const lastSlash = path.lastIndexOf("/");
          const dir = lastSlash >= 0 ? path.slice(0, lastSlash) : "";
          const key = `${bucket}::${dir}`;
          let g = dirGroups.get(key);
          if (!g) {
            g = { bucket, dir, rows: [] };
            dirGroups.set(key, g);
          }
          g.rows.push(r);
        }
        await Promise.all(
          Array.from(dirGroups.values()).map(async ({ bucket, dir, rows: grpRows }) => {
            try {
              const { data, error: listErr } = await supabase.storage
                .from(bucket)
                .list(dir, { limit: 1000 });
              if (listErr || !data) return;
              const names = new Set(data.map((d) => d.name));
              for (const r of grpRows) {
                const fname = r.storage_path!.slice(r.storage_path!.lastIndexOf("/") + 1);
                if (names.has(fname)) existsByRow.set(r.id, true);
              }
            } catch {
              /* ignore */
            }
          }),
        );
        const pdfjsLib = await import("pdfjs-dist");
        for (const row of missing) {
          if (cancelled) return;
          if (!existsByRow.get(row.id)) continue;
          try {
            // Route through the shared cache so this one-time page-count
            // download populates the same store the viewer/exporters read.
            const { blob } = await resolveDocumentSource({
              kind: "supabase-storage",
              bucket: bucketForSource(row.source_type),
              path: row.storage_path!,
              mimeType: row.mime_type || "application/pdf",
              version: row.size_bytes ?? undefined,
            });
            const buf = await blob.arrayBuffer();
            const doc = await pdfjsLib.getDocument({ data: buf }).promise;
            const count = doc.numPages;
            try { doc.destroy(); } catch { /* ignore */ }
            if (cancelled) return;
            setPageInfoRows((prev) =>
              {
                const next = prev.map((r) => (r.id === row.id ? { ...r, page_count: count } : r));
                try {
                  window.localStorage.setItem(cacheKey, JSON.stringify({ rows: next, updatedAt: Date.now() }));
                  if (projectCacheKey) window.localStorage.setItem(projectCacheKey, JSON.stringify({ rows: next, updatedAt: Date.now() }));
                } catch {
                  /* ignore cache */
                }
                return next;
              },
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
  }, [requestId, requestSourceType, projectId]);



  // Files + sheets for the latest request
  const { data: rows, isLoading } = useQuery({
    queryKey: ["workbench-rows", requestId],
    enabled: !!requestId,
    queryFn: async () => {
      const [filesRes, sheetsRes] = await Promise.all([
        supabase
          .from("analysis_request_files")
          .select("id, name, extracted_text, storage_path, mime_type, size_bytes, survey_raw_response, survey_raw_updated_at, risk_element_results")
          .eq("analysis_request_id", requestId!)
          .order("name"),

        supabase
          .from("analysis_request_sheets")
          .select(
            "id, parent_file_id, page_index, sheet_number, sheet_title, storage_path, extract_status, extracted_text, updated_at, survey_result, survey_updated_at, floor_plan_overrides",
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
        size_bytes: f.size_bytes ?? null,
        survey_raw_response: f.survey_raw_response ?? null,
        survey_raw_updated_at: f.survey_raw_updated_at ?? null,
        risk_element_results: f.risk_element_results ?? null,
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
            updated_at: s.updated_at ?? null,
            survey_result: s.survey_result ?? null,
            survey_updated_at: s.survey_updated_at ?? null,
            floor_plan_overrides: (s.floor_plan_overrides as Record<string, any> | null) ?? null,
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
    // Index sheets by (fileId, page) so we can apply per-page overrides.
    const sheetByFilePage = new Map<string, SheetRow>();
    for (const s of rows?.sheets ?? []) {
      sheetByFilePage.set(`${s.parent_file_id}::${s.page_index}`, s);
    }
    for (const f of rows?.files ?? []) {
      const raw = (f as any).survey_raw_response as string | null | undefined;
      const parsed = raw ? parseSurveyFloorPlans(raw) : new Map<number, ParsedFloorPlan[]>();
      const filtered = new Map<number, ParsedFloorPlan[]>();
      for (const [page, plans] of parsed.entries()) {
        const sheet = sheetByFilePage.get(`${f.id}::${page}`);
        const overrides = sheet?.floor_plan_overrides ?? null;
        const deleted = getDeletedPlanIds(overrides);
        const keptRaw = plans.filter((p) => !deleted.has(p.plan_id));
        const addedRaw = getAddedUnitPlans(overrides, page).filter(
          (p) => !deleted.has(p.plan_id),
        );
        const knownIds = new Set<string>([
          ...keptRaw.map((p) => p.plan_id),
          ...addedRaw.map((p) => p.plan_id),
        ]);
        const kept = keptRaw.map((p) => materializeFloorPlan(p, overrides));
        const added = addedRaw
          .map(addedUnitPlanToParsed)
          .map((p) => materializeFloorPlan(p, overrides));
        const manual = overrideOnlyFloorPlans(overrides, page, knownIds, deleted);
        if (kept.length > 0 || added.length > 0 || manual.length > 0) {
          filtered.set(page, [...kept, ...added, ...manual]);
        }
      }
      for (const s of rows?.sheets ?? []) {
        if (s.parent_file_id !== f.id || filtered.has(s.page_index)) continue;
        const overrides = s.floor_plan_overrides ?? null;
        const deleted = getDeletedPlanIds(overrides);
        const addedRaw = getAddedUnitPlans(overrides, s.page_index).filter(
          (p) => !deleted.has(p.plan_id),
        );
        const added = addedRaw
          .map(addedUnitPlanToParsed)
          .map((p) => materializeFloorPlan(p, overrides));
        const manual = overrideOnlyFloorPlans(
          overrides,
          s.page_index,
          new Set(addedRaw.map((p) => p.plan_id)),
          deleted,
        );
        if (added.length > 0 || manual.length > 0) filtered.set(s.page_index, [...added, ...manual]);
      }
      m.set(f.id, filtered);
    }
    return m;
  }, [rows?.files, rows?.sheets]);

  // File-wide level-plan overrides (units arrays) merged across every sheet
  // in the active file. Used to compute "Referenced in" for unit plans on
  // pages other than the one currently loaded in `activeFloorPlanOverrides`.
  const activeFileAllLevelPlanOverrides = useMemo<Record<string, { units?: string[] }>>(() => {
    const out: Record<string, { units?: string[] }> = {};
    const fileId = activePageView?.file.id;
    if (!fileId) return out;
    for (const s of rows?.sheets ?? []) {
      if (s.parent_file_id !== fileId) continue;
      const ovr = s.floor_plan_overrides as Record<string, any> | null;
      if (!ovr) continue;
      for (const [planId, v] of Object.entries(ovr)) {
        if (planId.startsWith("__")) continue;
        const units = (v as any)?.units;
        if (Array.isArray(units)) out[planId] = { units };
      }
    }
    return out;
  }, [rows?.sheets, activePageView?.file.id]);

  // File-wide level floor plans (both survey-parsed and user-added on any
  // page of the active file). Added level plans live in `__added_unit_plans`
  // (misnamed array — also holds level_floor_plan entries) and in override-
  // only floor-plan entries; merging across sheets is required so that
  // `Referenced in` on a unit-plan can find level plans from other pages.
  const activeFileAllLevelPlans = useMemo<ParsedFloorPlan[]>(() => {
    const deleted = getDeletedPlanIds(activeFloorPlanOverrides);
    const out: ParsedFloorPlan[] = [];
    const seen = new Set<string>();
    for (const plans of activeFileFloorPlansByPage.values()) {
      for (const p of plans) {
        const materialized = materializeFloorPlan(p, activeFloorPlanOverrides);
        if (materialized.type !== "level_floor_plan") continue;
        if (deleted.has(p.plan_id) || seen.has(materialized.plan_id)) continue;
        seen.add(materialized.plan_id);
        out.push(materialized);
      }
    }
    const activeFileId = activePageView?.file.id;
    for (const s of rows?.sheets ?? []) {
      if (!activeFileId || s.parent_file_id !== activeFileId) continue;
      const ovr = s.floor_plan_overrides as Record<string, any> | null;
      if (!ovr) continue;
      const sheetDeleted = getDeletedPlanIds(ovr);
      const sheetKnownIds = new Set<string>();
      for (const entry of getAddedUnitPlans(ovr)) {
        sheetKnownIds.add(entry.plan_id);
        const parsed = materializeFloorPlan(addedUnitPlanToParsed(entry), ovr);
        if (parsed.type !== "level_floor_plan") continue;
        if (sheetDeleted.has(parsed.plan_id) || deleted.has(parsed.plan_id)) continue;
        if (seen.has(parsed.plan_id)) continue;
        seen.add(parsed.plan_id);
        out.push(parsed);
      }
      for (const parsed of overrideOnlyFloorPlans(ovr, s.page_index, sheetKnownIds, sheetDeleted)) {
        if (parsed.type !== "level_floor_plan") continue;
        if (deleted.has(parsed.plan_id) || seen.has(parsed.plan_id)) continue;
        seen.add(parsed.plan_id);
        out.push(parsed);
      }
    }
    return out;
  }, [
    activeFileFloorPlansByPage,
    activeFloorPlanOverrides,
    activePageView?.file.id,
    rows?.sheets,
  ]);



  // File-wide unit floor plans (both survey-parsed and user-added on any page
  // of the active file). Merging across sheets is required because a level
  // plan on page N can reference a Detail added on page M - each sheet stores
  // its own __added_unit_plans array.
  const activeFileAllUnitPlans = useMemo<ParsedFloorPlan[]>(() => {
    const deleted = getDeletedPlanIds(activeFloorPlanOverrides);
    const out: ParsedFloorPlan[] = [];
    for (const plans of activeFileFloorPlansByPage.values()) {
      for (const p of plans) {
        const materialized = materializeFloorPlan(p, activeFloorPlanOverrides);
        if (materialized.type === "unit_floor_plan" && !deleted.has(p.plan_id)) {
          out.push(materialized);
        }
      }
    }
    const activeFileId = activePageView?.file.id;
    const seen = new Set(out.map((p) => p.plan_id));
    const refSeen = new Set(out.map((p) => unitPlanRefKey(p).toLowerCase()));
    for (const entry of getAddedUnitPlans(activeFloorPlanOverrides)) {
      const parsed = materializeFloorPlan(
        addedUnitPlanToParsed(entry),
        activeFloorPlanOverrides,
      );
      if (parsed.type !== "unit_floor_plan") continue;
      if (deleted.has(parsed.plan_id) || seen.has(parsed.plan_id)) continue;
      seen.add(parsed.plan_id);
      refSeen.add(unitPlanRefKey(parsed).toLowerCase());
      out.push(parsed);
    }
    for (const s of rows?.sheets ?? []) {
      if (!activeFileId || s.parent_file_id !== activeFileId) continue;
      const ovr = s.floor_plan_overrides as Record<string, any> | null;
      if (!ovr) continue;
      const sheetDeleted = getDeletedPlanIds(ovr);
      const sheetKnownIds = new Set<string>();
      for (const entry of getAddedUnitPlans(ovr)) {
        sheetKnownIds.add(entry.plan_id);
        const parsed = materializeFloorPlan(addedUnitPlanToParsed(entry), ovr);
        if (parsed.type !== "unit_floor_plan") continue;
        if (sheetDeleted.has(parsed.plan_id) || deleted.has(parsed.plan_id)) continue;
        const refKey = unitPlanRefKey(parsed).toLowerCase();
        if (seen.has(parsed.plan_id) || refSeen.has(refKey)) continue;
        seen.add(parsed.plan_id);
        refSeen.add(refKey);
        out.push(parsed);
      }
      for (const parsed of overrideOnlyFloorPlans(ovr, s.page_index, sheetKnownIds, sheetDeleted)) {
        if (parsed.type !== "unit_floor_plan") continue;
        if (deleted.has(parsed.plan_id)) continue;
        const refKey = unitPlanRefKey(parsed).toLowerCase();
        if (seen.has(parsed.plan_id) || refSeen.has(refKey)) continue;
        seen.add(parsed.plan_id);
        refSeen.add(refKey);
        out.push(parsed);
      }
    }
    return out;
  }, [
    activeFileFloorPlansByPage,
    activeFloorPlanOverrides,
    activePageView?.file.id,
    rows?.sheets,
  ]);

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


  // Egress control: no eager prewarm. PDFs are downloaded only when the user
  // explicitly opens a drawing, or hovers a drawing row (see `prewarmRow`
  // below in the file-row render) which fires a debounced background fetch.

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

  // In-flight pipeline jobs - used to show per-cell spinners during triage
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
  // have annotations in this analysis request - used to gate the
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

  // Total annotations per page (sheet) - triage + user/analysis instances.
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

  // Per-page validity filter for space badges: when a sheet's floor plans
  // have been edited (deletions or manual additions), only space names whose
  // backing floor plan still exists should appear in the page→spaces map.
  // Pages without overrides are untouched (legacy behavior).
  const pageSpaceValidNames = useMemo(() => {
    const validByKey = new Map<string, Set<string>>();
    const overridden = new Set<string>();
    if (!rows) return { validByKey, overridden };
    const sheetsByFile = new Map<string, typeof rows.sheets>();
    for (const s of rows.sheets) {
      const arr = sheetsByFile.get(s.parent_file_id) || [];
      arr.push(s);
      sheetsByFile.set(s.parent_file_id, arr);
    }
    for (const f of rows.files) {
      const raw = (f as any).survey_raw_response as string | null | undefined;
      const parsed = raw ? parseSurveyFloorPlans(raw) : new Map<number, ParsedFloorPlan[]>();
      const sheets = sheetsByFile.get(f.id) || [];
      for (const sheet of sheets) {
        const ovr = sheet.floor_plan_overrides;
        if (!ovr) continue;
        const deleted = getDeletedPlanIds(ovr);
        const added = getAddedUnitPlans(ovr, sheet.page_index).map(addedUnitPlanToParsed);
        if (deleted.size === 0 && added.length === 0) continue;
        const base = parsed.get(sheet.page_index) || [];
        const kept = [...base.filter((p) => !deleted.has(p.plan_id)), ...added];
        const key = `${f.name}::${sheet.page_index}`;
        overridden.add(key);
        const valid = new Set<string>();
        for (const p of kept) {
          if (p.type === "level_floor_plan") {
            for (const fl of p.floors) valid.add(fl.toLowerCase());
          } else if (p.type === "unit_floor_plan" && p.reference_id) {
            valid.add(p.reference_id.toLowerCase());
          }
        }
        validByKey.set(key, valid);
      }
    }
    return { validByKey, overridden };
  }, [rows]);

  const isSpaceValidOnPage = (key: string, name: string): boolean => {
    if (!pageSpaceValidNames.overridden.has(key)) return true;
    const valid = pageSpaceValidNames.validByKey.get(key);
    return !!valid && valid.has(name.toLowerCase());
  };

  // Map "fileName::pageNumber" -> [level names], built from parsed hierarchy.
  // Spatial Template records (units/suites/amenities) with applies_to_levels
  // are expanded into their parent levels so their pages are attributed to
  // the right physical levels.
  const pageSpaceMap = useMemo(() => {
    const map = new Map<string, string[]>();
    const spaces = extractSpaces(spaceHierarchyPayload?.parsed);
    for (const sp of spaces) {
      const name = sp?.standardized_space_name;
      if (!name) continue;
      const appliesTo: string[] = Array.isArray(sp?.applies_to_levels)
        ? sp.applies_to_levels.filter((s: any) => typeof s === "string")
        : [];
      const cat = typeof sp?.space_category === "string" ? sp.space_category.toLowerCase() : "";
      const isTemplate = cat && cat !== "contiguous storey" && cat !== "level";
      const projectedNames = isTemplate && appliesTo.length > 0 ? appliesTo : [name];
      for (const src of sp?.matched_sources || []) {
        const key = `${src?.file_name}::${src?.page_number}`;
        for (const projected of projectedNames) {
          if (!isSpaceValidOnPage(key, projected)) continue;
          const arr = map.get(key) || [];
          if (!arr.includes(projected)) arr.push(projected);
          map.set(key, arr);
        }
      }
    }
    return map;
  }, [spaceHierarchyPayload, pageSpaceValidNames]);

  // Unit-aware page map: "fileName::pageNumber" -> [{level, unit?}, ...].
  // Sources of unit entries:
  //   - Spatial Template records in spatial_records with applies_to_levels
  //     (e.g. "Template - Suite 2A" applied to "Level 2").
  //   - unit_templates entries (legacy/typical-unit-plans).
  // Sources of level entries: spatial_records with empty applies_to_levels.
  // Spatial-architect derived page→level entries.
  // NOTE: We intentionally do NOT emit unit attributions from spatial-architect
  // templates' `applies_to_levels` here. That fan-out caused every templated
  // unit/suite to appear on every level it _could_ apply to (e.g. Suite 1H
  // showing on Levels 2-6 instead of just where the user actually placed a
  // unit-floor-plan bbox). Unit attribution comes exclusively from survey-
  // derived assignments (user-placed bounding boxes). Only level-category
  // records contribute here, so unit lists are anchored to explicit drawings.
  const pageSpaceUnitMap = useMemo(() => {
    const map = new Map<string, Array<{ level: string; unit?: string }>>();
    const parsed: any = spaceHierarchyPayload?.parsed;
    const spaces = extractSpaces(parsed);
    for (const sp of spaces) {
      const name = sp?.standardized_space_name;
      if (!name) continue;
      const cat = typeof sp?.space_category === "string" ? sp.space_category.toLowerCase() : "";
      const isLevel = !cat || cat === "contiguous storey" || cat === "level";
      if (!isLevel) continue;
      for (const src of sp?.matched_sources || []) {
        const key = `${src?.file_name}::${src?.page_number}`;
        if (!isSpaceValidOnPage(key, name)) continue;
        const arr = map.get(key) || [];
        arr.push({ level: name });
        map.set(key, arr);
      }
    }
    return map;
  }, [spaceHierarchyPayload, pageSpaceValidNames]);

  // Canonical level names + normalization. Level floor plans store raw `floors`
  // text ("2nd Floor") which often doesn't match the canonical SPACES name
  // ("Level 2") shown in the threat report sidebar. We normalize raw → canonical
  // so attribution lands in the right space instead of leaking to Unassigned.
  const canonicalLevelNames = useMemo<string[]>(() => {
    return extractSpaces(spaceHierarchyPayload?.parsed)
      .filter((sp) => {
        const cat = typeof sp?.space_category === "string" ? sp.space_category.toLowerCase() : "";
        return !cat || cat === "level" || cat === "contiguous storey";
      })
      .map((sp) => sp?.standardized_space_name)
      .filter((x): x is string => typeof x === "string" && !!x);
  }, [spaceHierarchyPayload]);

  const normalizeLevelToken = (s: string): string => {
    const wordToDigit: Record<string, string> = {
      first: "1", second: "2", third: "3", fourth: "4", fifth: "5",
      sixth: "6", seventh: "7", eighth: "8", ninth: "9", tenth: "10",
      eleventh: "11", twelfth: "12",
    };
    let t = (s || "")
      .toLowerCase()
      .replace(/\b(level|floor|plan|layout|plumbing|mechanical|electrical|story|storey)\b/g, " ")
      .replace(/(\d+)\s*(st|nd|rd|th)\b/g, "$1")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    t = t.split(/\s+/).map((w) => wordToDigit[w] ?? w).join(" ").trim();
    return t;
  };

  // Returns one or more canonical level names for a raw floors string.
  // Returns multiple names when the raw text refers to a shared physical
  // space (e.g. "Parking Garage" maps to both Level P1 and Level P2 Sub-Slab
  // when both exist in the project's canonical level list).
  const canonicalizeLevels = (raw: string): string[] => {
    if (!raw) return [];
    const target = normalizeLevelToken(raw);
    if (!target) return [raw];

    // Parking / garage expansion: a generic parking page applies to every
    // canonical parking level (P1, P2 Sub-Slab, etc.) unless the raw text
    // already names a specific level number.
    const looksLikeParking =
      /(parking|garage|underground|sub\s*slab)/i.test(raw) &&
      !/\b(p\s*\d|level\s*\d|floor\s*\d|\d(st|nd|rd|th)?)\b/i.test(raw);
    if (looksLikeParking) {
      const parkingMatches = canonicalLevelNames.filter((p) =>
        /(p\d|parking|garage|sub\s*slab|underground)/i.test(p),
      );
      if (parkingMatches.length > 0) return parkingMatches;
    }

    for (const p of canonicalLevelNames) {
      if (normalizeLevelToken(p) === target) return [p];
    }
    for (const p of canonicalLevelNames) {
      const pn = normalizeLevelToken(p);
      if (pn && (pn === target || pn.split(" ").includes(target) || target.split(" ").includes(pn))) {
        return [p];
      }
    }
    return [raw];
  };

  // Survey-derived rollup: uses existing per-page floor-plan metadata
  // (level_floor_plan.floors[] + referenced_unit_ids[]) to map unit floor
  // plan pages back to their parent level(s). Independent of spatial-architect.
  const surveyDerivedMaps = useMemo(() => {
    const levelMap = new Map<string, Set<string>>();
    const unitMap = new Map<string, Array<{ level: string; unit?: string }>>();
    // Per-page unit floor plans (with bbox + parent levels + per-level counts)
    // for per-annotation bbox-containment attribution in the threat report.
    // A unit listed N times under a level expands to N pairs in the rollup.
    const pageUnitPlans = new Map<
      string,
      Array<{
        unitLabel: string;
        levels: string[];
        levelsWithCounts: Array<{ level: string; count: number }>;
        bbox: [number, number, number, number] | null;
      }>
    >();
    // Per-page level floor plans (with bbox + canonical level names) for
    // bbox-containment attribution when a page has multiple level plans.
    const pageLevelPlans = new Map<
      string,
      Array<{
        levels: string[]; // canonical names
        bbox: [number, number, number, number] | null;
      }>
    >();
    const files = rows?.files ?? [];
    const sheets = rows?.sheets ?? [];
    if (files.length === 0) return { levelMap, unitMap, pageUnitPlans, pageLevelPlans };

    const overridesByFilePage = new Map<string, Record<string, any>>();
    for (const s of sheets) {
      overridesByFilePage.set(
        `${s.parent_file_id}::${s.page_index}`,
        (s.floor_plan_overrides as Record<string, any>) ?? {},
      );
    }
    const effective = (fp: ParsedFloorPlan, fileId: string) => {
      const ovr = overridesByFilePage.get(`${fileId}::${fp.page_number}`)?.[fp.plan_id] ?? {};
      const type: string = typeof ovr.type === "string" && ovr.type ? ovr.type : fp.type;
      const floors: string[] = Array.isArray(ovr.floors) ? ovr.floors : fp.floors;
      const units: string[] = Array.isArray(ovr.units) ? ovr.units : fp.referenced_unit_ids;
      const bbox: [number, number, number, number] | null =
        Array.isArray(ovr.bbox_pct) && ovr.bbox_pct.length === 4 && ovr.bbox_pct.every((n: any) => Number.isFinite(n))
          ? [ovr.bbox_pct[0], ovr.bbox_pct[1], ovr.bbox_pct[2], ovr.bbox_pct[3]]
          : fp.xy_width_height_pct;
      // Effective name: user-typed override.name wins over Scout's reference_id.
      // Level plans reference units by this human-readable name, so unit plans
      // must expose the same string as their identifier.
      const name: string =
        typeof ovr.name === "string" && ovr.name.trim()
          ? ovr.name.trim()
          : (fp.reference_id || floorPlanDisplayLabel(fp));
      // Level plans that were manually added (or where the survey didn't
      // capture a floors[] value) still carry the human level identifier
      // in `name` (e.g. "L9"). Treat that as the level label so downstream
      // attribution can canonicalize it into the physical space and roll
      // annotations under the right level instead of Unassigned.
      const effFloors = (floors && floors.length > 0)
        ? floors
        : (type === "level_floor_plan" && name ? [name] : []);
      return { type, floors: effFloors, units: units || [], bbox, name };
    };

    // unit ref (lowercased) -> canonical level -> occurrence count.
    const unitRefToLevelCounts = new Map<string, Map<string, number>>();
    for (const f of files) {
      const byPage = floorPlansByFile.get(f.id);
      if (!byPage) continue;
      for (const plans of byPage.values()) {
        for (const fp of plans) {
          const e = effective(fp, f.id);
          if (e.type !== "level_floor_plan") continue;
          for (const ref of e.units) {
            const k = (ref || "").trim().toLowerCase();
            if (!k) continue;
            const inner = unitRefToLevelCounts.get(k) || new Map<string, number>();
            for (const lvl of e.floors) {
              if (!lvl) continue;
              for (const canonical of canonicalizeLevels(lvl)) {
                inner.set(canonical, (inner.get(canonical) || 0) + 1);
              }
            }
            unitRefToLevelCounts.set(k, inner);
          }
        }
      }
    }

    for (const f of files) {
      const byPage = floorPlansByFile.get(f.id);
      if (!byPage) continue;
      for (const [page, plans] of byPage.entries()) {
        const key = `${f.name}::${page}`;
        for (const fp of plans) {
          const e = effective(fp, f.id);
          if (e.type === "level_floor_plan") {
            const canonicalLevels = e.floors.flatMap((l) => canonicalizeLevels(l)).filter(Boolean);
            const lpArr = pageLevelPlans.get(key) || [];
            lpArr.push({ levels: canonicalLevels, bbox: e.bbox });
            pageLevelPlans.set(key, lpArr);

            const ls = levelMap.get(key) || new Set<string>();
            for (const lvl of canonicalLevels) if (lvl) ls.add(lvl);
            levelMap.set(key, ls);
            const pairs = unitMap.get(key) || [];
            for (const lvl of canonicalLevels) {
              if (!lvl) continue;
              if (!pairs.some((p) => p.level === lvl && !p.unit)) pairs.push({ level: lvl });
            }
            unitMap.set(key, pairs);
          } else if (e.type === "unit_floor_plan") {
            const unitLabel = e.name;
            const refKey = e.name.trim().toLowerCase();
            const counts = refKey ? unitRefToLevelCounts.get(refKey) : null;
            const levelsWithCounts: Array<{ level: string; count: number }> = counts
              ? Array.from(counts.entries()).map(([level, count]) => ({ level, count }))
              : [];
            const parentLevels = levelsWithCounts.map((x) => x.level);

            const upArr = pageUnitPlans.get(key) || [];
            upArr.push({ unitLabel, levels: parentLevels, levelsWithCounts, bbox: e.bbox });
            pageUnitPlans.set(key, upArr);

            if (parentLevels.length === 0) continue;
            const pairs = unitMap.get(key) || [];
            const ls = levelMap.get(key) || new Set<string>();
            for (const lvl of parentLevels) {
              ls.add(lvl);
              if (!pairs.some((p) => p.level === lvl && p.unit === unitLabel)) {
                pairs.push({ level: lvl, unit: unitLabel });
              }
            }
            levelMap.set(key, ls);
            unitMap.set(key, pairs);
          }
        }
      }
    }

    return { levelMap, unitMap, pageUnitPlans, pageLevelPlans };
  }, [rows?.files, rows?.sheets, floorPlansByFile, canonicalLevelNames]);

  const pageUnitPlansMap = surveyDerivedMaps.pageUnitPlans;
  const pageLevelPlansMap = surveyDerivedMaps.pageLevelPlans;

  // Merge survey (primary) with spatial-architect maps (supplemental fallback).
  const mergedPageSpaceMap = useMemo(() => {
    const out = new Map<string, string[]>();
    const addAll = (key: string, levels: Iterable<string>) => {
      const arr = out.get(key) || [];
      for (const lvl of levels) {
        if (!isSpaceValidOnPage(key, lvl)) continue;
        if (!arr.includes(lvl)) arr.push(lvl);
      }
      out.set(key, arr);
    };
    for (const [key, levels] of surveyDerivedMaps.levelMap.entries()) addAll(key, levels);
    for (const [key, levels] of pageSpaceMap.entries()) addAll(key, levels);
    return out;
  }, [surveyDerivedMaps, pageSpaceMap, pageSpaceValidNames]);

  const mergedPageSpaceUnitMap = useMemo(() => {
    const out = new Map<string, Array<{ level: string; unit?: string }>>();
    const push = (key: string, pair: { level: string; unit?: string }) => {
      if (!isSpaceValidOnPage(key, pair.level)) return;
      const arr = out.get(key) || [];
      if (!arr.some((p) => p.level === pair.level && p.unit === pair.unit)) arr.push(pair);
      out.set(key, arr);
    };
    for (const [key, pairs] of surveyDerivedMaps.unitMap.entries()) for (const p of pairs) push(key, p);
    for (const [key, pairs] of pageSpaceUnitMap.entries()) for (const p of pairs) push(key, p);
    return out;
  }, [surveyDerivedMaps, pageSpaceUnitMap, pageSpaceValidNames]);

  const spacesForSheet = (fileName: string, pageIndex: number): string[] => {
    return mergedPageSpaceMap.get(`${fileName}::${pageIndex}`) || [];
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
    setDraftAliases({ ...aliasMap });
    setDraftAliasPrefixes({ ...aliasPrefixMap });
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

      // Persist alias changes: diff draft vs current maps.
      const allClassKeys = new Set<string>([
        ...Object.keys(aliasMap),
        ...Object.keys(aliasPrefixMap),
        ...Object.keys(draftAliases),
        ...Object.keys(draftAliasPrefixes),
      ]);
      for (const name of allClassKeys) {
        const prevAlias = aliasMap[name] ?? "";
        const prevPrefix = aliasPrefixMap[name] ?? "";
        const nextAlias = (draftAliases[name] ?? "").trim();
        const nextPrefix = (draftAliasPrefixes[name] ?? "").trim();
        if (prevAlias === nextAlias && prevPrefix === nextPrefix) continue;
        await saveClassAlias(name, nextAlias, nextPrefix);
      }

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
      version: activeSheet.updated_at ?? undefined,
    };
  }, [activeSheet]);

  const fileSource = useMemo<DocumentSourceDescriptor | null>(() => {
    if (!activeFile || !activeFile.storage_path) return null;
    return {
      kind: "supabase-storage",
      bucket: bucketForSource(activeFile.source_type),
      path: activeFile.storage_path,
      mimeType: activeFile.mime_type || "application/pdf",
      version: activeFile.size_bytes ?? undefined,
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

  // Fetch counts of destructive items before opening the Clear All dialog.
  // Used to decide whether to require typed confirmation and to show the user
  // exactly what they are about to lose (safeguard against silent data wipes).
  const openClearAllDialog = async () => {
    if (!requestId) return;
    setClearConfirmText("");
    setClearCounts({
      drawing_instances: 0,
      annotation_consolidations: 0,
      manual_floor_plans: 0,
      surveyed_files: 0,
      loading: true,
    });
    setClearOpen(true);
    try {
      const [instRes, consRes] = await Promise.all([
        supabase
          .from("drawing_instances")
          .select("id", { count: "exact", head: true })
          .eq("analysis_request_id", requestId),
        supabase
          .from("annotation_consolidations" as any)
          .select("id", { count: "exact", head: true })
          .eq("analysis_request_id", requestId),
      ]);
      // Count manual floor-plan overrides across the sheets already in `rows`
      // (both per-plan overrides and __added_unit_plans entries).
      let manualFloorPlans = 0;
      for (const s of rows?.sheets ?? []) {
        const ovr = (s.floor_plan_overrides ?? {}) as Record<string, any>;
        for (const [k, v] of Object.entries(ovr)) {
          if (k === "__added_unit_plans") {
            if (Array.isArray(v)) manualFloorPlans += v.length;
          } else if (!k.startsWith("__")) {
            // per-plan override (name/bbox/units)
            if (v && typeof v === "object") manualFloorPlans += 1;
          }
        }
      }
      const surveyedFiles = (rows?.files ?? []).filter(
        (f) => (f as any).survey_raw_response && String((f as any).survey_raw_response).trim().length > 0,
      ).length;
      setClearCounts({
        drawing_instances: instRes.count ?? 0,
        annotation_consolidations: consRes.count ?? 0,
        manual_floor_plans: manualFloorPlans,
        surveyed_files: surveyedFiles,
        loading: false,
      });
    } catch (e) {
      setClearCounts((prev) => (prev ? { ...prev, loading: false } : prev));
    }
  };

  // True when Clear All will destroy user-authored data. In that case we
  // require the user to type "delete" before the button becomes enabled.
  const clearRequiresConfirmation = !!clearCounts && !clearCounts.loading && (
    clearCounts.drawing_instances > 0 ||
    clearCounts.annotation_consolidations > 0 ||
    clearCounts.manual_floor_plans > 0 ||
    clearCounts.surveyed_files > 0
  );
  const clearConfirmed =
    !clearRequiresConfirmation || clearConfirmText.trim().toLowerCase() === "delete";

  const clearAll = async () => {
    if (!requestId) return;
    if (!clearConfirmed) return;
    setClearing(true);
    // Snapshot the counts we're about to destroy so the audit log records
    // exactly what was lost even if the fetch races the delete.
    const audit = clearCounts
      ? {
          drawing_instances: clearCounts.drawing_instances,
          annotation_consolidations: clearCounts.annotation_consolidations,
          manual_floor_plans: clearCounts.manual_floor_plans,
          surveyed_files: clearCounts.surveyed_files,
        }
      : null;
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
        // User-drawn bounding-box annotations
        supabase
          .from("drawing_instances")
          .delete()
          .eq("analysis_request_id", requestId),
        // Riser unifier groupings (level↔unit relationships)
        supabase
          .from("annotation_consolidations" as any)
          .delete()
          .eq("analysis_request_id", requestId),
      ]);
      // Clear extracted text + floor plan overrides on sheets
      await Promise.all([
        supabase
          .from("analysis_request_files")
          .update({ extracted_text: null })
          .eq("analysis_request_id", requestId),
        supabase
          .from("analysis_request_sheets")
          .update({ extracted_text: null, extract_status: "pending", floor_plan_overrides: {} } as any)
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

      // Audit trail - always logged (safeguard against silent data loss).
      void logActivity("workbench_clear_all", projectId ?? undefined, {
        analysis_request_id: requestId,
        destroyed: audit,
        required_typed_confirmation: clearRequiresConfirmation,
      });

      queryClient.invalidateQueries({ queryKey: ["workbench-rows", requestId] });
      queryClient.invalidateQueries({ queryKey: ["workbench-triage", requestId] });
      queryClient.invalidateQueries({ queryKey: ["workbench-overrides", requestId] });
      queryClient.invalidateQueries({
        queryKey: ["workbench-analysis-request", projectId],
      });
      toast({ title: "All results cleared" });
      setClearOpen(false);
      setClearConfirmText("");
      setClearCounts(null);
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

  // -------- Risk Radar (identify-risk-elements) modal + dispatcher --------
  const riskRadarStorageKey = requestId ? `riskradar-selection-${requestId}` : null;

  const openRiskRadarModal = useCallback(() => {
    if (!requestId || enabledCols.length === 0) return;
    let initial: string[] = enabledCols;
    if (riskRadarStorageKey) {
      try {
        const raw = window.sessionStorage.getItem(riskRadarStorageKey);
        if (raw) {
          const parsed = JSON.parse(raw) as unknown;
          if (Array.isArray(parsed)) {
            const filtered = parsed.filter(
              (n): n is string => typeof n === "string" && enabledCols.includes(n),
            );
            if (filtered.length > 0) initial = filtered;
          }
        }
      } catch {
        /* ignore malformed storage */
      }
    }
    setRiskRadarSelection(new Set(initial));
    setRiskRadarModalOpen(true);
  }, [requestId, enabledCols, riskRadarStorageKey]);

  const runRiskRadar = useCallback(async () => {
    if (!requestId || !rows?.files?.length) return;
    const selected = Array.from(riskRadarSelection).filter((n) =>
      enabledCols.includes(n),
    );
    if (selected.length === 0) return;
    if (riskRadarStorageKey) {
      try {
        window.sessionStorage.setItem(
          riskRadarStorageKey,
          JSON.stringify(selected),
        );
      } catch {
        /* ignore */
      }
    }
    setRiskRadarModalOpen(false);
    setIdentifyRunning(true);
    try {
      const results = await Promise.allSettled(
        rows.files.map((f) =>
          supabase.functions.invoke("identify-risk-elements", {
            body: {
              analysisRequestId: requestId,
              fileId: f.id,
              awpClassNames: selected,
            },
          }),
        ),
      );
      const ok = results.filter(
        (r) => r.status === "fulfilled" && !(r.value as any)?.error,
      ).length;
      const failed = results.length - ok;
      toast({
        title: "Risk Radar dispatched",
        description: `${ok} file${ok === 1 ? "" : "s"} started${failed ? `, ${failed} failed` : ""} · ${selected.length} class${selected.length === 1 ? "" : "es"}.`,
        variant: failed ? "destructive" : "default",
      });
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Risk Radar failed",
        description: err?.message ?? "Unknown error",
      });
    } finally {
      setIdentifyRunning(false);
    }
  }, [requestId, rows?.files, riskRadarSelection, enabledCols, riskRadarStorageKey, toast]);



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
      const message = getUserFriendlyError(error);
      // Reconcile the DB row - if the edge function crashed or timed out before
      // it could mark itself failed, the row would stay `running` forever and
      // the modal would keep spinning. Force it to `failed` here so the UI
      // matches the toast the user just saw.
      try {
        await supabase
          .from("analysis_requests")
          .update({
            space_hierarchy_status: "failed",
            space_hierarchy_error: message || "Spatial Architect request failed.",
            space_hierarchy_updated_at: new Date().toISOString(),
          } as any)
          .eq("id", requestId)
          .eq("space_hierarchy_status", "running");
      } catch (_) {
        /* best-effort reconcile */
      }
      queryClient.invalidateQueries({
        queryKey: ["workbench-analysis-request", projectId],
      });
      toast({
        variant: "destructive",
        title: "Spatial Architect failed",
        description: message,
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
          children: [new TextRun({ text: `RiskBlue Workbench Export - ${projectName}`, bold: true })],
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
            {/* Action toolbar - the Agents row lives further below in the
                page (Scout · Vulnerability Radar · Spatial Architect · Unify
                Riser · Threat Report · Clear All · Renumber IDs · 🐛). */}


            {/* Survey Pages */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-start gap-2">
                <span className="text-sm font-medium text-muted-foreground mr-1">Risk Agents:</span>
                <Button
                  type="button"
                  onClick={async () => {
                    if (!requestId) return;
                    // Safeguard: if Scout has already run on any file in this
                    // request, require typed confirmation before overwriting.
                    // Re-running Scout replaces survey_raw_response, which the
                    // whole Workbench UI (floor plans, spaces, threat report)
                    // reads from - an accidental re-run silently destroys work.
                    const filesWithSurvey = (rows?.files ?? []).filter(
                      (f) => (f as any).survey_raw_response && String((f as any).survey_raw_response).trim().length > 0,
                    );
                    // Consume the one-shot bypass first so a confirmed re-run
                    // doesn't loop back into the same dialog.
                    const bypass = scoutBypassConfirmRef.current;
                    scoutBypassConfirmRef.current = false;
                    if (filesWithSurvey.length > 0 && !bypass) {
                      // Defer the original run until the user types "delete".
                      // Capture the click target so we can re-dispatch it once
                      // confirmed (avoids duplicating the ~100-line runner).
                      const btn = (typeof window !== "undefined" ? document.activeElement : null) as HTMLButtonElement | null;
                      scoutRerunAfterConfirmRef.current = () => {
                        scoutRerunAfterConfirmRef.current = null;
                        scoutBypassConfirmRef.current = true;
                        setScoutConfirmOpen(false);
                        setScoutConfirmText("");
                        // Re-click the original button; the bypass ref is now
                        // set so the guard above will skip the confirmation.
                        setTimeout(() => btn?.click(), 0);
                      };
                      void logActivity("workbench_scout_rerun", projectId ?? undefined, {
                        analysis_request_id: requestId,
                        files_with_existing_survey: filesWithSurvey.length,
                        prompted_for_confirmation: true,
                      });
                      setScoutConfirmOpen(true);
                      return;
                    }
                    // Passed the gate (either no prior survey, or the user
                    // just typed "delete"). Log the actual run.
                    if (filesWithSurvey.length > 0) {
                      void logActivity("workbench_scout_rerun_confirmed_overwrite", projectId ?? undefined, {
                        analysis_request_id: requestId,
                        files_with_existing_survey: filesWithSurvey.length,
                      });
                    }
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
                      Surveying…
                    </>
                  ) : (
                    "Scout"
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!requestId || surveyRunning || identifyRunning || enabledCols.length === 0}
                  onClick={() => openRiskRadarModal()}
                >
                  {identifyRunning ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Scanning…
                    </>
                  ) : (
                    "Risk Radar"
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setSpatialArchitectOpen(true)}
                  disabled={!requestId}
                  title="View and edit canonical levels; run the Spatial Architect agent."
                >
                  {spaceHierarchyRunning ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Spatial Architect…
                    </>
                  ) : (
                    "Spatial Architect"
                  )}
                </Button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span tabIndex={0}>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setConsolidateOpen(true)}
                        disabled={!requestId || !hasRisersSelected}
                      >
                        Riser Unifier
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {!hasRisersSelected
                      ? "No riser selected for risk identification"
                      : "Group riser annotations into multi-space instances"}
                  </TooltipContent>
                </Tooltip>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setInstancesReportOpen(true)}
                  disabled={!requestId}
                  title="Generate per-space threat report"
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
                  onClick={openClearAllDialog}
                  disabled={!requestId || phaseRunning}
                >
                  Clear All
                </Button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => setScoutDebugOpen(true)}
                      aria-label="Agent debug"
                    >
                      <Bug className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Agent debug</TooltipContent>
                </Tooltip>

              </div>

              {/* Raw response modal - shown when a file is picked from the Scout debug list. */}
              <Dialog
                open={!!surveyResponseModal}
                onOpenChange={(open) => !open && setSurveyResponseModal(null)}
              >
                <DialogContent className="max-w-[80vw] w-[80vw] h-[80vh] flex flex-col">
                  <DialogHeader>
                    <DialogTitle className="truncate">
                      {(surveyResponseModal?.label ?? "Scout response")} · {surveyResponseModal?.fileName}
                    </DialogTitle>
                  </DialogHeader>
                  <Textarea
                    readOnly
                    value={surveyResponseModal?.raw ?? ""}
                    className="font-mono text-xs flex-1 min-h-0 resize-none"
                  />
                </DialogContent>
              </Dialog>

              {/* Scout debug modal - lists files with raw responses; pick one to view. */}
              <Dialog open={scoutDebugOpen} onOpenChange={setScoutDebugOpen}>
                <DialogContent className="max-w-[640px] w-[640px] max-h-[80vh] flex flex-col">
                  <DialogHeader>
                    <DialogTitle>Agent Debug</DialogTitle>
                  </DialogHeader>
                  <div className="flex-1 min-h-0 overflow-auto space-y-4">
                    <div>
                      <div className="text-sm font-semibold mb-2">Scout Agent</div>
                      {(() => {
                        const allFiles = (rows?.files ?? [])
                          .slice()
                          .sort((a, b) => a.name.localeCompare(b.name));
                        if (allFiles.length === 0) {
                          return (
                            <div className="text-xs text-muted-foreground border rounded-md p-4 text-center">
                              No files uploaded yet.
                            </div>
                          );
                        }
                        return (
                          <ul className="divide-y border rounded-md">
                            {allFiles.map((f) => {
                              const raw = (f.survey_raw_response ?? "").trim();
                              const hasResponse = raw.length > 0;
                              const updatedAt = (f as any).survey_raw_updated_at as string | null;
                              const tokens = (f as any).survey_tokens as any;
                              const model = (f as any).survey_model as string | null;
                              return (
                                <li
                                  key={f.id}
                                  className="px-3 py-2 flex items-center justify-between gap-3"
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="text-sm font-medium truncate">
                                      {f.name}
                                      {model ? <span className="text-muted-foreground ml-1 text-xs">· {model}</span> : null}
                                    </div>
                                    <div className="text-[11px] text-muted-foreground">
                                      {hasResponse
                                        ? `${updatedAt ? new Date(updatedAt).toLocaleString() : "-"} · ${raw.length.toLocaleString()} chars`
                                        : "No response yet"}
                                    </div>
                                    {tokens ? (
                                      <div className="text-[10px] text-muted-foreground">
                                        in {Number(tokens.prompt ?? 0).toLocaleString()} · cached {Number(tokens.cached ?? 0).toLocaleString()} ({tokens.cacheHitPct ?? 0}%) · out {Number(tokens.candidates ?? 0).toLocaleString()} · total {Number(tokens.total ?? 0).toLocaleString()}
                                        {tokens.chunks ? ` · ${tokens.chunks} chunk${tokens.chunks === 1 ? "" : "s"}` : ""}
                                        {tokens.durationMs ? ` · ${formatDuration(tokens.durationMs)}` : ""}
                                      </div>
                                    ) : null}
                                  </div>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={!hasResponse}
                                    onClick={() => {
                                      setSurveyResponseModal({
                                        fileName: f.name,
                                        raw: normalizeScoutResponse(f.survey_raw_response),
                                        label: "Scout response",
                                      });
                                    }}
                                  >
                                    View Response
                                  </Button>
                                </li>
                              );
                            })}
                          </ul>
                        );
                      })()}
                    </div>

                    {/* Risk Radar Agent section */}
                    <div>
                      <div className="text-sm font-semibold mb-2">Risk Radar Agent</div>
                      {(() => {
                        const allFiles = (rows?.files ?? [])
                          .slice()
                          .sort((a, b) => a.name.localeCompare(b.name));
                        if (allFiles.length === 0) {
                          return (
                            <div className="text-xs text-muted-foreground border rounded-md p-4 text-center">
                              No files uploaded yet.
                            </div>
                          );
                        }
                        return (
                          <div className="border rounded-md divide-y">
                            {allFiles.map((f) => {
                              const rer = (f.risk_element_results ?? {}) as Record<string, any>;
                              const classNames = Object.keys(rer).sort();
                              return (
                                <div key={f.id} className="px-3 py-2">
                                  <div className="text-sm font-medium truncate">{f.name}</div>
                                  {classNames.length === 0 ? (
                                    <div className="text-[11px] text-muted-foreground mt-1">
                                      No Risk Radar runs yet.
                                    </div>
                                  ) : (
                                    <ul className="mt-2 space-y-1">
                                      {classNames.map((cn) => {
                                        const entry = rer[cn] ?? {};
                                        const text = (entry.result_text ?? "").toString();
                                        const promptText = (entry.prompt_text ?? "").toString();
                                        const hasResp = text.trim().length > 0;
                                        const hasPrompt = promptText.trim().length > 0;
                                        const err = entry.error as string | null | undefined;
                                        const tokens = entry.tokens ?? null;
                                        const model = entry.model ?? null;
                                        return (
                                          <li
                                            key={cn}
                                            className="flex items-center justify-between gap-3 text-xs"
                                          >
                                            <div className="min-w-0 flex-1">
                                              <div className="truncate">
                                                <span className="font-medium">{cn}</span>
                                                {model ? (
                                                  <span className="text-muted-foreground ml-1">· {model}</span>
                                                ) : null}
                                              </div>
                                              <div className="text-[10px] text-muted-foreground truncate">
                                                {err
                                                  ? <span className="text-destructive">Error: {err}</span>
                                                    : tokens
                                                      ? `in ${Number(tokens.prompt ?? 0).toLocaleString()} · cached ${Number(tokens.cached ?? 0).toLocaleString()} (${tokens.cacheHitPct ?? 0}%) · out ${Number(tokens.candidates ?? 0).toLocaleString()} · total ${Number(tokens.total ?? 0).toLocaleString()}${tokens.durationMs ? ` · ${formatDuration(tokens.durationMs)}` : ""}`
                                                      : hasResp ? `${text.length.toLocaleString()} chars` : "No response"}
                                              </div>
                                            </div>
                                            <div className="flex items-center gap-1">
                                              <Button
                                                size="sm"
                                                variant="outline"
                                                disabled={!hasPrompt}
                                                onClick={() => {
                                                  setSurveyResponseModal({
                                                    fileName: `${f.name} · ${cn}`,
                                                    raw: promptText,
                                                    label: "Risk Radar prompt",
                                                  });
                                                }}
                                              >
                                                View Prompt
                                              </Button>
                                              <Button
                                                size="sm"
                                                variant="outline"
                                                disabled={!hasResp}
                                                onClick={() => {
                                                  setSurveyResponseModal({
                                                    fileName: `${f.name} · ${cn}`,
                                                    raw: text,
                                                    label: "Risk Radar response",
                                                  });
                                                }}
                                              >
                                                View Response
                                              </Button>
                                            </div>
                                          </li>
                                        );
                                      })}
                                    </ul>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>

                    {/* Spatial Architect Agent section */}
                    <div>
                      <div className="text-sm font-semibold mb-2">Spatial Architect Agent</div>
                      {(() => {
                        const payload = spaceHierarchyPayload;
                        const status = analysisRequest?.space_hierarchy_status as string | null | undefined;
                        const updatedAt = analysisRequest?.space_hierarchy_updated_at as string | null | undefined;
                        const error = analysisRequest?.space_hierarchy_error as string | null | undefined;
                        const rawText: string = (payload?.raw_text ?? "").toString();
                        const parsed = payload?.parsed ?? null;
                        const hasResp = rawText.trim().length > 0 || !!parsed;
                        const model = payload?.model ?? null;
                        const source = payload?.source ?? null;
                        const parseError = payload?.parse_error ?? null;
                        const displayText = rawText.trim().length > 0
                          ? rawText
                          : parsed ? JSON.stringify(parsed, null, 2) : "";

                        return (
                          <div className="border rounded-md px-3 py-2">
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-medium truncate">
                                  Space Hierarchy
                                  {source ? <span className="text-muted-foreground ml-1 text-xs">· {source}</span> : null}
                                  {model ? <span className="text-muted-foreground ml-1 text-xs">· {model}</span> : null}
                                </div>
                                <div className="text-[11px] text-muted-foreground">
                                  {error || parseError ? (
                                    <span className="text-destructive">Error: {error || parseError}</span>
                                  ) : hasResp ? (
                                    `${status ?? "-"} · ${updatedAt ? new Date(updatedAt).toLocaleString() : "-"} · ${displayText.length.toLocaleString()} chars`
                                  ) : (
                                    status === "running" ? "Running…" : "No response yet"
                                  )}
                                </div>
                                {(() => {
                                  const usage = (payload as any)?.usage;
                                  const durationMs = Number((payload as any)?.duration_ms ?? 0);
                                  if (!usage && !durationMs) return null;
                                  const prompt = Number(usage?.promptTokenCount ?? 0);
                                  const cached = Number(usage?.cachedContentTokenCount ?? 0);
                                  const cand = Number(usage?.candidatesTokenCount ?? 0);
                                  const total = Number(usage?.totalTokenCount ?? 0);
                                  const pct = prompt > 0 ? Math.round((cached / prompt) * 100) : 0;
                                  return (
                                    <div className="text-[10px] text-muted-foreground">
                                      {usage ? `in ${prompt.toLocaleString()} · cached ${cached.toLocaleString()} (${pct}%) · out ${cand.toLocaleString()} · total ${total.toLocaleString()}` : ""}
                                      {durationMs ? `${usage ? " · " : ""}${formatDuration(durationMs)}` : ""}
                                    </div>
                                  );
                                })()}
                              </div>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={!hasResp}
                                onClick={() => {
                                  
                                  setSurveyResponseModal({
                                    fileName: "Space Hierarchy",
                                    raw: displayText,
                                    label: "Spatial Architect response",
                                  });
                                }}
                              >
                                View Response
                              </Button>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
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
                          const alias = aliasMap[name];
                          const aliasPrefix = aliasPrefixMap[name];
                          // Prefer the per-project acronym override, then the
                          // per-project display alias, then the canonical
                          // short prefix.
                          const label = aliasPrefix || alias || opt?.idPrefix || name;
                          const tooltipName = alias
                            ? `${alias} (${name})`
                            : name;
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
                                  <TooltipContent side="bottom">{tooltipName} - click to view prompt</TooltipContent>
                                </Tooltip>
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
                                {scoreKnown ? "" : "-"}
                              </span>
                            );
                          const title = !clickable
                            ? undefined
                            : override === "include"
                              ? "Manually included - click to clear"
                              : override === "exclude"
                                ? "Manually excluded - click to clear"
                                : hasScore
                                  ? `Triage: ${score}%${cnt > 0 ? ` · ${cnt}` : ""} - click to ${cnt > 0 ? "exclude" : "include"}`
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
                              onClick={(e) => {
                                if (!clickable) return;
                                e.stopPropagation();
                                toggleOverride(fileId, awpClassName, cnt);
                              }}
                            >
                              <span className="inline-flex items-center justify-center w-full">
                                {override === "exclude" ? (
                                  <span className="line-through text-muted-foreground">
                                    {cnt > 0 ? cnt : "-"}
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
                            {/* File-level row - matches first table */}
                            <TableRow
                              className="group h-8 cursor-pointer"
                              onMouseEnter={() => handleRowHoverStart(row)}
                              onMouseLeave={() => handleRowHoverEnd(row.id)}
                              onFocus={() => handleRowHoverStart(row)}
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

                            {/* Per-page sub-rows (only when multi-page AND expanded) - matches first table */}
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
                                    onMouseEnter={() => handleRowHoverStart(row)}
                                    onMouseLeave={() => handleRowHoverEnd(row.id)}
                                    onFocus={() => handleRowHoverStart(row)}
                                    onClick={() => setActivePageView({ file: row, page: p })}
                                  >
                                    <TableCell
                                      className={`${stickyCellFirstBase} bg-muted/10 group-hover:bg-muted/30 py-1 text-sm`}
                                    >
                                      <div className="flex items-center gap-1.5 min-w-0 pl-7 flex-wrap">
                                        <span className="text-muted-foreground shrink-0">
                                          Page {p}
                                        </span>
                                        {(() => {
                                          if (levelPlans.length === 0) return null;
                                          const c = awpClassColor("Level Floor Plan");
                                          return levelPlans.map((lvl, i) => {
                                            const label =
                                              (lvl.floors && lvl.floors.length > 0
                                                ? formatLevelSetLabel(lvl.floors)
                                                : "") || floorPlanDisplayLabel(lvl);
                                            return (
                                              <Badge
                                                key={`lvl-${i}-${lvl.plan_id}`}
                                                variant="outline"
                                                className="h-5 px-1.5 text-[10px]"
                                                style={{ backgroundColor: softBgFrom(c), color: c, borderColor: softBgFrom(c, 0.5) }}
                                              >
                                                {label}
                                              </Badge>
                                            );
                                          });
                                        })()}
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
                                            <span className="text-muted-foreground">-</span>
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







        {/* Drawing modal - single sheet */}
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

        {/* Parent file modal - full multi-page PDF with page navigation */}
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
            allLevelPlanOverrides={activeFileAllLevelPlanOverrides}
            floorPlanOverrides={activeFloorPlanOverrides}
            onSaveFloorPlanOverride={saveFloorPlanOverride}
            onEditFloors={openFloorEditForPlan}
            onSaveLevelUnits={async (plan, units, createdRefs, removedRefs) => {
              const fileId = activePageView.file.id;
              const page = activePageView.page;
              const sheetId = activeSheetIdForPage;
              // Optimistic update off the current in-memory overrides so the
              // badge / count reflect the click immediately.
              const baseOverrides = activeFloorPlanOverrides ?? {};
              const optimistic: Record<string, any> = {
                ...baseOverrides,
                [plan.plan_id]: {
                  ...(baseOverrides[plan.plan_id] ?? {}),
                  units,
                },
              };
              const existingAddedOpt = Array.isArray(baseOverrides[ADDED_UNIT_PLANS_KEY])
                ? (baseOverrides[ADDED_UNIT_PLANS_KEY] as any[])
                : [];
              let nextAddedOpt = existingAddedOpt;
              if (createdRefs && createdRefs.length > 0) {
                const existingRefs = new Set(
                  existingAddedOpt
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
                if (toAdd.length > 0) nextAddedOpt = [...nextAddedOpt, ...toAdd];
              }
              if (removedRefs && removedRefs.length > 0) {
                const removeSet = new Set(removedRefs);
                nextAddedOpt = nextAddedOpt.filter(
                  (e) =>
                    !(e?.page_number === page && removeSet.has(e?.reference_id)),
                );
              }
              if (nextAddedOpt !== existingAddedOpt) {
                optimistic[ADDED_UNIT_PLANS_KEY] = nextAddedOpt;
              }
              if (sheetId) setActiveFloorPlanOverrides(optimistic);

              // Re-fetch the authoritative row to avoid clobbering concurrent
              // edits, then merge our delta onto it.
              const { data: sheet, error: sheetErr } = await supabase
                .from("analysis_request_sheets")
                .select("id, floor_plan_overrides")
                .eq("parent_file_id", fileId)
                .eq("page_index", page)
                .maybeSingle();
              if (sheetErr || !sheet) {
                if (sheetId) setActiveFloorPlanOverrides(baseOverrides);
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
                if (sheetId) setActiveFloorPlanOverrides(baseOverrides);
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
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Manage columns</DialogTitle>
              <DialogDescription>
                Pick which assets and water systems appear as columns, and
                customize their acronym and name for this project. Shared
                across all internal users.
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
            <div className="max-h-[60vh] overflow-auto py-2">
              {Object.entries(grouped).map(([category, opts]) => (
                <div key={category} className="mb-5">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                    {category}
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8"></TableHead>
                        <TableHead className="w-24">Acronym</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead className="w-10"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {opts.map((opt) => {
                        const checked = draftCols.includes(opt.name);
                        const aliasVal = draftAliases[opt.name] ?? "";
                        const prefixVal = draftAliasPrefixes[opt.name] ?? "";
                        return (
                          <TableRow key={opt.id}>
                            <TableCell className="py-1.5">
                              <Checkbox
                                checked={checked}
                                onCheckedChange={() => toggleDraft(opt.name)}
                              />
                            </TableCell>
                            <TableCell className="py-1.5">
                              <Input
                                value={prefixVal}
                                placeholder={opt.idPrefix ?? ""}
                                onChange={(e) =>
                                  setDraftAliasPrefixes((prev) => ({
                                    ...prev,
                                    [opt.name]: e.target.value,
                                  }))
                                }
                                className="h-8 font-mono text-xs"
                              />
                            </TableCell>
                            <TableCell className="py-1.5">
                              <Input
                                value={aliasVal}
                                placeholder={opt.name}
                                onChange={(e) =>
                                  setDraftAliases((prev) => ({
                                    ...prev,
                                    [opt.name]: e.target.value,
                                  }))
                                }
                                className="h-8 text-sm"
                              />
                            </TableCell>
                            <TableCell className="py-1.5 text-right">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                    disabled={phaseRunning || !checked}
                                    onClick={() => clearClassResults(opt.name)}
                                    aria-label={`Clear results for ${opt.name}`}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent side="left">Clear results for this class</TooltipContent>
                              </Tooltip>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
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

        {/* Scout re-run confirmation - protects existing survey_raw_response
            from silent overwrite. */}
        <Dialog
          open={scoutConfirmOpen}
          onOpenChange={(open) => {
            if (!open) {
              scoutRerunAfterConfirmRef.current = null;
              setScoutConfirmText("");
            }
            setScoutConfirmOpen(open);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Re-run Scout on files with existing data?</DialogTitle>
              <DialogDescription>
                Scout has already run on one or more files in this project.
                Re-running will overwrite the existing Scout output
                (<span className="font-mono">survey_raw_response</span>) which drives
                all floor-plan bounding boxes, level/unit lists, spaces, and the
                Threat Report. Manual annotations placed by hand are kept, but
                any automated results from the previous Scout run are lost.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <label className="text-sm font-medium text-destructive">
                Type <span className="font-mono">delete</span> to confirm.
              </label>
              <Input
                value={scoutConfirmText}
                onChange={(e) => setScoutConfirmText(e.target.value)}
                placeholder="delete"
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  scoutRerunAfterConfirmRef.current = null;
                  setScoutConfirmText("");
                  setScoutConfirmOpen(false);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={scoutConfirmText.trim().toLowerCase() !== "delete"}
                onClick={() => scoutRerunAfterConfirmRef.current?.()}
              >
                Overwrite and re-run Scout
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Clear All confirmation */}
        <Dialog open={clearOpen} onOpenChange={(open) => !clearing && setClearOpen(open)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Clear all results?</DialogTitle>
              <DialogDescription>
                This removes annotations, floor-plan bounding boxes, level↔unit
                relationships, extracted text, and Workbench overrides for this
                project. The uploaded files themselves are not removed.
              </DialogDescription>
            </DialogHeader>
            {clearCounts?.loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Counting items that will be deleted…
              </div>
            ) : clearCounts ? (
              <div className="space-y-3">
                <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm space-y-1">
                  <div className="font-medium">This will permanently delete:</div>
                  <ul className="list-disc pl-5 text-muted-foreground">
                    <li>
                      <span className="tabular-nums font-medium text-foreground">
                        {clearCounts.drawing_instances}
                      </span>{" "}
                      annotation{clearCounts.drawing_instances === 1 ? "" : "s"} (DCW / FS / etc.)
                    </li>
                    <li>
                      <span className="tabular-nums font-medium text-foreground">
                        {clearCounts.manual_floor_plans}
                      </span>{" "}
                      manually-placed floor-plan bounding box
                      {clearCounts.manual_floor_plans === 1 ? "" : "es"}
                    </li>
                    <li>
                      <span className="tabular-nums font-medium text-foreground">
                        {clearCounts.annotation_consolidations}
                      </span>{" "}
                      level↔unit relationship
                      {clearCounts.annotation_consolidations === 1 ? "" : "s"}
                    </li>
                    <li>
                      Scout survey output on{" "}
                      <span className="tabular-nums font-medium text-foreground">
                        {clearCounts.surveyed_files}
                      </span>{" "}
                      file{clearCounts.surveyed_files === 1 ? "" : "s"}{" "}
                      <span className="text-xs">
                        (extracted text cleared; raw Scout JSON is preserved on the file
                        row and can only be overwritten by re-running Scout)
                      </span>
                    </li>
                  </ul>
                </div>
                {clearRequiresConfirmation ? (
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-destructive">
                      Type <span className="font-mono">delete</span> to confirm.
                    </label>
                    <Input
                      value={clearConfirmText}
                      onChange={(e) => setClearConfirmText(e.target.value)}
                      placeholder="delete"
                      autoFocus
                      disabled={clearing}
                    />
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    No manual annotations or floor plans present - safe to clear.
                  </div>
                )}
              </div>
            ) : null}
            <DialogFooter>
              <Button variant="outline" onClick={() => setClearOpen(false)} disabled={clearing}>Cancel</Button>
              <Button
                onClick={clearAll}
                disabled={clearing || (clearCounts?.loading ?? true) || !clearConfirmed}
                variant={clearRequiresConfirmation ? "destructive" : "default"}
              >
                {clearing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Clear All"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>


        <SpaceHierarchyModal
          open={spaceModalOpen}
          onOpenChange={setSpaceModalOpen}
          payload={spaceHierarchyHasResult ? spaceHierarchyPayload ?? null : null}
        />

        <InstancesReportModal
          open={instancesReportOpen}
          onOpenChange={setInstancesReportOpen}
          requestId={requestId}
          projectId={projectId!}
          fileGroups={fileGroups}
          optionByName={optionByName}
          pageSpaceMap={mergedPageSpaceMap}
          pageSpaceUnitMap={mergedPageSpaceUnitMap}
          pageUnitPlansMap={pageUnitPlansMap}
          pageLevelPlansMap={pageLevelPlansMap}


          spaceHierarchyPayload={spaceHierarchyPayload}
          projectName={project?.name || "Project"}
          enabledClassNames={enabledCols}
          consolidations={consolidations || []}
          aliasMap={aliasMap}
          aliasPrefixMap={aliasPrefixMap}
        />

        <SpatialArchitectModal
          open={spatialArchitectOpen}
          onOpenChange={setSpatialArchitectOpen}
          requestId={requestId}
          payload={spaceHierarchyPayload}
          status={analysisRequest?.space_hierarchy_status as any}
          error={analysisRequest?.space_hierarchy_error as any}
          updatedAt={analysisRequest?.space_hierarchy_updated_at as any}
          running={spaceHierarchyRunning}
          fileGroups={fileGroups}
          onBuild={buildSpaceHierarchy}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ["workbench-analysis-request", projectId] });
          }}
        />

        <ConsolidateRisersModal
          open={consolidateOpen}
          onOpenChange={setConsolidateOpen}
          requestId={requestId}
          spannableClasses={spannableClassesWithAnnotations}
          fileNameById={new Map(fileGroups.map((g) => [g.file.id, g.file.name]))}
          pageSpaceMap={mergedPageSpaceMap}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ["workbench-consolidations", requestId] });
          }}
        />
      </div>
    </TooltipProvider>
  );
}

// ---------------------------------------------------------------------------
// AwpPromptModal - shows prompt content + opens source Google Doc
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
// SpaceHierarchyModal - pretty-printed JSON viewer with copy
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
// ExtractedTextBody - shows file extracted text without page line-break headers
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
// InstancesReportModal - translates annotations to per-space instance IDs
// ---------------------------------------------------------------------------
function InstancesReportModal({
  open,
  onOpenChange,
  requestId,
  projectId,
  fileGroups,
  optionByName,
  pageSpaceMap,
  pageSpaceUnitMap,
  pageUnitPlansMap,
  pageLevelPlansMap,
  spaceHierarchyPayload,
  projectName,
  enabledClassNames,
  consolidations,
  aliasMap,
  aliasPrefixMap,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  requestId: string | undefined;
  projectId: string;
  fileGroups: Array<{ file: FileRow; sheets: SheetRow[] }>;
  optionByName: Map<string, { idPrefix: string | null; category: string }>;
  pageSpaceMap: Map<string, string[]>;
  pageSpaceUnitMap: Map<string, Array<{ level: string; unit?: string }>>;
  pageUnitPlansMap: Map<string, Array<{ unitLabel: string; levels: string[]; levelsWithCounts: Array<{ level: string; count: number }>; bbox: [number, number, number, number] | null }>>;
  pageLevelPlansMap: Map<string, Array<{ levels: string[]; bbox: [number, number, number, number] | null }>>;
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
  aliasMap: Record<string, string>;
  aliasPrefixMap: Record<string, string>;
}) {
  const displayClassName = useCallback(
    (name: string) => aliasMap[name] || name,
    [aliasMap],
  );
  const displayPrefix = useCallback(
    (name: string) =>
      aliasPrefixMap[name] ||
      optionByName.get(name)?.idPrefix ||
      name.slice(0, 3).toUpperCase(),
    [aliasPrefixMap, optionByName],
  );



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
        .select("id, awp_class_name, file_id, page_index, instance_number, nx, ny, created_at, metadata")
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

  // Resolve per-annotation (level, unit?) pairs.
  //
  // When the annotation's page has unit floor plans, use bbox containment to
  // attribute the annotation to the SPECIFIC unit it sits inside - never every
  // unit on the page. A single unit on the page is auto-attributed. If no unit
  // bbox contains the point, the annotation is dropped (→ Unassigned).
  //
  // When the page has no unit plans, fall back to the legacy page-level
  // (level, unit?) map / level-only map.
  const pairsForPage = (
    fileName: string,
    pageIndex: number,
    nx?: number,
    ny?: number,
  ): Array<{ level: string; unit?: string }> => {
    const key = `${fileName}::${pageIndex}`;
    const unitPlans = pageUnitPlansMap.get(key) || [];
    if (unitPlans.length > 0) {
      let matched:
        | {
            unitLabel: string;
            levels: string[];
            levelsWithCounts: Array<{ level: string; count: number }>;
            bbox: [number, number, number, number] | null;
          }
        | null = null;
      // Only auto-attribute to the single unit plan when no level plans
      // exist on this page. If the page also has level plans, we need bbox
      // containment to disambiguate; otherwise every marker on the page
      // (including ones sitting on the level plan) would be misattributed
      // to the lone unit.
      const levelPlansOnPage = pageLevelPlansMap.get(key) || [];
      if (unitPlans.length === 1 && levelPlansOnPage.length === 0) {
        matched = unitPlans[0];
      } else if (typeof nx === "number" && typeof ny === "number") {
        for (const up of unitPlans) {
          const bb = up.bbox;
          if (!bb) continue;
          const [x, y, w, h] = bb;
          const x1 = x / 100, y1 = y / 100, x2 = (x + w) / 100, y2 = (y + h) / 100;
          if (nx >= x1 && nx <= x2 && ny >= y1 && ny <= y2) {
            matched = up;
            break;
          }
        }
      }
      if (matched) {
        const lwc =
          matched.levelsWithCounts && matched.levelsWithCounts.length > 0
            ? matched.levelsWithCounts
            : matched.levels.map((l) => ({ level: l, count: 1 }));
        if (lwc.length === 0) return [];
        const out: Array<{ level: string; unit?: string }> = [];
        for (const { level, count } of lwc) {
          const n = Math.max(1, count | 0);
          for (let i = 0; i < n; i++) {
            const unit = n <= 1 ? matched.unitLabel : `${matched.unitLabel} (${i + 1})`;
            out.push({ level, unit });
          }
        }
        return out;
      }
      // No unit bbox contained the marker - fall through to level-plan
      // containment below so markers on the level plan (outside every unit
      // detail) still land on the right level instead of being Unassigned.
    }
    // No unit plans on this page - try level plan bbox containment next.
    // If multiple level plans share a page (e.g. 2nd Floor + 3rd Floor),
    // attribute to the one whose bbox contains the point. If none contains
    // it, drop to Unassigned. Single-level page auto-attributes.
    const levelPlans = pageLevelPlansMap.get(key) || [];
    if (levelPlans.length > 0) {
      let matchedLp: { levels: string[]; bbox: [number, number, number, number] | null } | null = null;
      if (levelPlans.length === 1) {
        matchedLp = levelPlans[0];
      } else if (typeof nx === "number" && typeof ny === "number") {
        for (const lp of levelPlans) {
          const bb = lp.bbox;
          if (!bb) continue;
          const [x, y, w, h] = bb;
          const x1 = x / 100, y1 = y / 100, x2 = (x + w) / 100, y2 = (y + h) / 100;
          if (nx >= x1 && nx <= x2 && ny >= y1 && ny <= y2) {
            matchedLp = lp;
            break;
          }
        }
      }
      if (!matchedLp) return [];
      return matchedLp.levels.filter(Boolean).map((l) => ({ level: l }));
    }
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
      pipeDiameter: string | null;
      pipeType: string | null;
      // Stable key per logical instance - used to de-duplicate the same
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
      const padded = String(num).padStart(3, "0");
      const fileName = fileNameById.get(inst.file_id) || "";
      const pairs = pairsForPage(fileName, inst.page_index, Number(inst.nx) || 0, Number(inst.ny) || 0);
      const md =
        inst.metadata && typeof inst.metadata === "object"
          ? (inst.metadata as Record<string, any>)
          : {};
      const diameter =
        typeof md.pipe_diameter === "string"
          ? (md.pipe_diameter as string).trim() || null
          : null;
      const pipeType =
        typeof md.pipe_type === "string"
          ? (md.pipe_type as string).trim() || null
          : null;
      // When a Type value is present (CW/HW), fold it into the acronym:
      // "CW-Potable-001". Otherwise fall back to the compact "CW001" form.
      const base = pipeType ? `${prefix}-${pipeType}-${padded}` : `${prefix}${padded}`;
      const common = {
        annotationBaseId: base,
        awpClassName: inst.awp_class_name,
        category,
        fileId: inst.file_id,
        pageIndex: inst.page_index,
        nx: Number(inst.nx) || 0,
        ny: Number(inst.ny) || 0,
        pipeDiameter: diameter,
        pipeType,
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
        const pairs = pairsForPage(fname, m.page_index, Number(m.nx) || 0, Number(m.ny) || 0);
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
          pipeDiameter: null, pipeType: null,
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
            pipeDiameter: null, pipeType: null,
            logicalKey: `cons::${groupKey}::${k}`,
          });
        }
      }
    }

    return rows;
  }, [instances, optionByName, fileNameById, pageSpaceMap, pageSpaceUnitMap, pageUnitPlansMap, pageLevelPlansMap, enabledClassSet, consolidationByAnnId]);


  const levelNames = useMemo(() => {
    const s = new Set<string>();
    const _p: any = spaceHierarchyPayload?.parsed;
    const hierarchySpaces: any[] = _p?.physical_spaces || _p?.spatial_records || [];
    for (const sp of hierarchySpaces) {
      const name = sp?.standardized_space_name;
      if (!name) continue;
      const cat = typeof sp?.space_category === "string" ? sp.space_category.toLowerCase() : "";
      // Only physical levels (contiguous storeys) qualify as report spaces.
      // Spatial Templates (unit suites, amenity templates) live within levels.
      if (cat && cat !== "contiguous storey") continue;
      s.add(name);
    }
    return s;
  }, [spaceHierarchyPayload]);

  const spaceList = useMemo(() => {
    const set = new Set<string>();
    // Only physical spaces (levels) from spatial_records belong in the report
    // spaces list. Units (unit_templates) are sub-spaces and should appear in
    // the level detail, not as standalone spaces.
    for (const name of levelNames) set.add(name);
    let hasUnassigned = false;
    for (const r of expanded) {
      if (r.spaceName && levelNames.has(r.spaceName)) {
        set.add(r.spaceName);
      } else {
        hasUnassigned = true;
      }
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
  }, [expanded, spaceIndexMap, levelNames]);


  const classCols = useMemo(() => {
    const map = new Map<string, string>();
    // Include every enabled class (Asset/Water System) so zero-count rows
    // still appear in Overview/Summary - 0 is meaningful information.
    for (const name of enabledClassNames || []) {
      const cat = optionByName.get(name)?.category;
      if (cat === "Asset" || cat === "Water System") map.set(name, cat);
    }
    // Also include any class present in the data even if not in enabled list
    // (defensive: matches prior behavior for classes outside the toggle set).
    for (const r of expanded) {
      if (r.category === "Asset" || r.category === "Water System") {
        if (!map.has(r.awpClassName)) map.set(r.awpClassName, r.category);
      }
    }
    return Array.from(map.entries())
      .sort((a, b) => {
        if (a[1] !== b[1]) return a[1] === "Asset" ? -1 : 1;
        return a[0].localeCompare(b[0]);
      })
      .map(([name, category]) => ({ name, category }));
  }, [expanded, enabledClassNames, optionByName]);

  const overviewTotals = useMemo(() => {
    const m = new Map<string, number>();
    const seenConsolidated = new Set<string>();
    for (const r of expanded) {
      if (r.category !== "Asset" && r.category !== "Water System") continue;
      // A consolidated logical instance counts ONCE regardless of how many
      // spaces it spans (the riser unifier intentionally collapses these).
      // Plain annotations still count per row (per-space).
      if (r.logicalKey.startsWith("cons::")) {
        const groupDedupKey = `${r.awpClassName}::${r.annotationBaseId}`;
        if (seenConsolidated.has(groupDedupKey)) continue;
        seenConsolidated.add(groupDedupKey);
      }
      m.set(r.awpClassName, (m.get(r.awpClassName) || 0) + 1);
    }
    return m;
  }, [expanded]);

  const summaryMatrix = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    for (const r of expanded) {
      if (r.category !== "Asset" && r.category !== "Water System") continue;
      const space = r.spaceName && levelNames.has(r.spaceName) ? r.spaceName : "__unassigned__";
      const inner = m.get(space) || new Map<string, number>();
      inner.set(r.awpClassName, (inner.get(r.awpClassName) || 0) + 1);
      m.set(space, inner);
    }
    return m;
  }, [expanded, levelNames]);

  // Per-Type split entries used by both the Threat Report preview modal
  // (Overview tiles + Summary matrix) and the DOCX export payload. Cold
  // Water / Hot Water classes expand into one entry per distinct Type value
  // (with a "(untyped)" bucket); every other class stays as-is.
  type OverviewEntry = {
    key: string;
    canonicalName: string;
    displayName: string;
    displayPrefix: string;
    typeGroup: string | null;
  };
  const isTypedClassName = useCallback(
    (n: string) => /(^|\s)(cold|hot)\s*water(\s|$)/i.test(n),
    [],
  );
  const overviewEntries = useMemo<OverviewEntry[]>(() => {
    const typeOf = (r: (typeof expanded)[number]) =>
      r.pipeType && r.pipeType.trim() ? r.pipeType.trim() : "(untyped)";
    const diameterOf = (r: (typeof expanded)[number]) =>
      r.pipeDiameter && r.pipeDiameter.trim() ? r.pipeDiameter.trim() : "(no size)";
    // Numeric-aware diameter sort ("15mm" < "22mm" < "76mm" < "(no size)").
    const diameterSortKey = (d: string) => {
      if (d === "(no size)") return Number.POSITIVE_INFINITY;
      const m = d.match(/-?\d+(\.\d+)?/);
      return m ? parseFloat(m[0]) : Number.POSITIVE_INFINITY;
    };
    // Short type token for the acronym pill (e.g. "Potable" -> "P").
    const shortToken = (t: string) => {
      if (t === "(untyped)") return "?";
      const parts = t.split(/[\s\-_/]+/).filter(Boolean);
      if (parts.length >= 2) return parts.map((p) => p[0]).join("").toUpperCase().slice(0, 3);
      return t.slice(0, 2).toUpperCase();
    };
    return classCols.flatMap((c) => {
      const base = displayClassName(c.name);
      const basePrefix = displayPrefix(c.name);
      if (!isTypedClassName(c.name)) {
        return [{
          key: c.name,
          canonicalName: c.name,
          displayName: base,
          displayPrefix: basePrefix,
          typeGroup: null,
        }];
      }
      // Build unique (type, diameter) combos for this class.
      const combos = new Map<string, { type: string; diameter: string }>();
      for (const r of expanded) {
        if (r.awpClassName !== c.name) continue;
        if (r.category !== "Asset" && r.category !== "Water System") continue;
        const type = typeOf(r);
        const diameter = diameterOf(r);
        combos.set(`${type}::${diameter}`, { type, diameter });
      }
      if (combos.size === 0) {
        return [{
          key: c.name,
          canonicalName: c.name,
          displayName: base,
          displayPrefix: basePrefix,
          typeGroup: null,
        }];
      }
      return Array.from(combos.values())
        .sort((a, b) => {
          const t = a.type.localeCompare(b.type);
          if (t !== 0) return t;
          return diameterSortKey(a.diameter) - diameterSortKey(b.diameter);
        })
        .map(({ type, diameter }) => {
          const typeLabel = type === "(untyped)" ? "" : ` ${shortToken(type)}`;
          const typePrefix = type === "(untyped)" ? "" : `-${shortToken(type)}`;
          return {
            key: `${c.name}::${type}::${diameter}`,
            canonicalName: c.name,
            displayName: `${base}${typeLabel} ${diameter}`.replace(/\s+/g, " ").trim(),
            displayPrefix: `${basePrefix}${typePrefix} ${diameter}`.replace(/\s+/g, " ").trim(),
            typeGroup: type,
          };
        });
    });
  }, [classCols, expanded, displayClassName, displayPrefix, isTypedClassName]);

  const entryKeyForRow = useCallback(
    (r: (typeof expanded)[number]) => {
      if (!isTypedClassName(r.awpClassName)) return r.awpClassName;
      const type = r.pipeType && r.pipeType.trim() ? r.pipeType.trim() : "(untyped)";
      const diameter = r.pipeDiameter && r.pipeDiameter.trim() ? r.pipeDiameter.trim() : "(no size)";
      return `${r.awpClassName}::${type}::${diameter}`;
    },
    [isTypedClassName],
  );


  const overviewEntryTotals = useMemo(() => {
    const m = new Map<string, number>();
    const seen = new Set<string>();
    for (const r of expanded) {
      if (r.category !== "Asset" && r.category !== "Water System") continue;
      const key = entryKeyForRow(r);
      if (r.logicalKey.startsWith("cons::")) {
        const dedup = `${key}::${r.annotationBaseId}`;
        if (seen.has(dedup)) continue;
        seen.add(dedup);
      }
      m.set(key, (m.get(key) || 0) + 1);
    }
    return m;
  }, [expanded, entryKeyForRow]);

  const summaryEntryMatrix = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    for (const r of expanded) {
      if (r.category !== "Asset" && r.category !== "Water System") continue;
      const space =
        r.spaceName && levelNames.has(r.spaceName) ? r.spaceName : "__unassigned__";
      const key = entryKeyForRow(r);
      const inner = m.get(space) || new Map<string, number>();
      inner.set(key, (inner.get(key) || 0) + 1);
      m.set(space, inner);
    }
    return m;
  }, [expanded, levelNames, entryKeyForRow]);


  const instancesForSpace = (space: string) =>
    expanded
      .filter((r) =>
        space === "__unassigned__"
          ? !r.spaceName || !levelNames.has(r.spaceName)
          : r.spaceName === space,
      )
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
    const sourceDrawings = fileGroups.map((g) => g.file.name).join("; ") || "-";
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
          {overviewEntries.length === 0 ? (
            <div className="text-sm text-muted-foreground">No detections yet.</div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
              {overviewEntries.map((e) => (
                <div
                  key={e.key}
                  className="border rounded overflow-hidden text-center"
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="bg-sky-900 text-white text-xs font-semibold py-1 cursor-help">
                        {e.displayPrefix}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>{e.displayName}</TooltipContent>
                  </Tooltip>
                  <div className="py-2 text-2xl font-bold text-sky-700 tabular-nums">
                    {overviewEntryTotals.get(e.key) || 0}
                  </div>
                  <div className="text-[11px] text-muted-foreground pb-2 px-1">
                    {e.displayName}
                  </div>
                </div>
              ))}
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
              {overviewEntries.map((e) => (
                <TableHead
                  key={e.key}
                  className={`${compactHead} text-center whitespace-nowrap`}
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-help inline-block">
                        {e.displayPrefix}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{e.displayName}</TooltipContent>
                  </Tooltip>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {spaceList.map((space) => {
              const inner = summaryEntryMatrix.get(space);
              const label = space === "__unassigned__" ? "Unassigned" : space;
              return (
                <TableRow key={space} className={compactRow}>
                  <TableCell
                    className={`${compactCell} sticky left-0 bg-background font-medium`}
                  >
                    {label}
                  </TableCell>
                  {overviewEntries.map((e) => {
                    const val = inner?.get(e.key) || 0;
                    return (
                      <TableCell
                        key={e.key}
                        className={`${compactCell} text-center tabular-nums ${val === 0 ? "opacity-50" : ""}`}
                      >
                        {val}
                      </TableCell>
                    );
                  })}
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
    // Units assigned to this level - derived from pageUnitPlansMap so we can
    // honor the +/- picker count (a unit added twice → count = 2).
    const unitInfo = new Map<string, { count: number; pageIdxs: Set<number> }>();
    if (space !== "__unassigned__") {
      for (const [key, ups] of pageUnitPlansMap.entries()) {
        const [, pageStr] = key.split("::");
        const pageIdx = parseInt(pageStr, 10);
        for (const up of ups) {
          const lc = up.levelsWithCounts.find((x) => x.level === space);
          if (!lc || lc.count <= 0) continue;
          const cur = unitInfo.get(up.unitLabel) || { count: 0, pageIdxs: new Set<number>() };
          cur.count += lc.count;
          cur.pageIdxs.add(pageIdx);
          unitInfo.set(up.unitLabel, cur);
        }
      }
      // Fallback: include any (level, unit) pairs we know about but had no
      // matching unit_floor_plan page (e.g. spatial-architect supplied).
      for (const [key, pairs] of pageSpaceUnitMap.entries()) {
        for (const pair of pairs) {
          if (pair.level !== space || !pair.unit) continue;
          if (unitInfo.has(pair.unit)) continue;
          const [, pageStr] = key.split("::");
          unitInfo.set(pair.unit, { count: 1, pageIdxs: new Set([parseInt(pageStr, 10)]) });
        }
      }
    }
    const unitsList = Array.from(unitInfo.entries())
      .map(([name, info]) => ({
        name,
        count: info.count,
        pages: Array.from(info.pageIdxs).sort((a, b) => a - b).map((pageIdx) => ({ pageIdx })),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
    const totalUnitCount = unitsList.reduce((acc, u) => acc + Math.max(1, u.count), 0);
    const unitNamesForLevel = new Set(unitsList.map((u) => u.name));

    // Drawings to display for this space:
    //   (a) pages with annotations attributed to this space,
    //   (b) level floor plan pages whose canonical level matches this space,
    //   (c) unit floor plan pages whose unit is connected to this level
    //       (via user-assigned bboxes / referenced_unit_ids on the level plan).
    // Spatial-architect template fan-outs are intentionally excluded so the
    // dropdown only lists the level + its connected units.
    const pageKeySet = new Set<string>();
    for (const r of rows) pageKeySet.add(`${r.fileId}::${r.pageIndex}`);
    const addByFileNamePage = (fileName: string, pageStr: string) => {
      const lookup = sheetByFilePage.get(`${fileName}::${pageStr}`);
      const fileId = lookup?.file?.id;
      if (!fileId) return;
      pageKeySet.add(`${fileId}::${pageStr}`);
    };
    if (space !== "__unassigned__") {
      for (const [key, lps] of pageLevelPlansMap.entries()) {
        if (!lps.some((lp) => lp.levels.includes(space))) continue;
        const [fileName, pageStr] = key.split("::");
        addByFileNamePage(fileName, pageStr);
      }
      if (unitNamesForLevel.size > 0) {
        for (const [key, ups] of pageUnitPlansMap.entries()) {
          if (!ups.some((up) => unitNamesForLevel.has(up.unitLabel))) continue;
          const [fileName, pageStr] = key.split("::");
          addByFileNamePage(fileName, pageStr);
        }
      }
    }
    const pageKeys = Array.from(pageKeySet);

    const showUnitCol = rows.some((r) => !!r.unitName);
    // Show attribute columns whenever any row in this space carries that
    // attribute — no class-name gating (class names may be renamed).
    const showDiameterCol = rows.some((r) => !!(r.pipeDiameter && r.pipeDiameter.trim()));
    const showTypeCol = rows.some((r) => !!(r.pipeType && r.pipeType.trim()));

    // Build tab entries (one per file+page).
    type TabEntry = {
      key: string;
      fileId: string;
      pageIdx: number;
      fileName: string;
      shortName: string;
      bucket: string;
      parentPath: string | null;
      sizeBytes: number | null;
      overlays: any[];
      // 0 = level plan for this space, 1 = unit plan rolling up to this space,
      // 2 = other (annotations attributed here without a matching plan).
      tier: number;
      tabLabel: string;
    };
    // Multi-file determination drives whether tab labels include the file name.
    const uniqueFileNames = new Set(
      pageKeys.map((k) => fileNameById.get(k.split("::")[0]) || ""),
    );
    const showFileInTab = uniqueFileNames.size > 1;
    const tabsUnsorted: TabEntry[] = pageKeys
      .map((key) => {
        const [fileId, pageIdxStr] = key.split("::");
        const pageIdx = parseInt(pageIdxStr, 10);
        const fileName = fileNameById.get(fileId) || "";
        const lookup = sheetByFilePage.get(`${fileName}::${pageIdx}`);
        if (!lookup) return null;
        const bucket = bucketForSource(lookup.sheet.file_source_type);
        const parentPath = lookup.file.storage_path;
        const sizeBytes = (lookup.file as any).size_bytes ?? null;
        const rawOverlays = rows
          .filter((r) => r.fileId === fileId && r.pageIndex === pageIdx);
        // Collapse markers that share the exact same (nx, ny) into a single
        // overlay whose label lists all instance IDs on separate lines.
        const groupsByPos = new Map<string, typeof rawOverlays>();
        for (const r of rawOverlays) {
          const k = `${(r.nx ?? 0).toFixed(4)}::${(r.ny ?? 0).toFixed(4)}`;
          const arr = groupsByPos.get(k) ?? [];
          arr.push(r);
          groupsByPos.set(k, arr);
        }
        const overlays = Array.from(groupsByPos.values()).map((group) => {
          const r = group[0];
          const labels = group.map((g) =>
            g.pipeDiameter ? `${g.instanceId} (${g.pipeDiameter})` : g.instanceId,
          );
          return {
            id: `${r.instanceId}-${group.length}`,
            bbox: [r.nx, r.ny, 0, 0] as [number, number, number, number],
            coordSpace: "normalized" as const,
            page: pageIdx,
            color: awpClassColor(r.awpClassName),
            label: labels.join("\n"),
            shape: "circle" as const,
          };
        });
        const shortName = fileName.replace(/\.[^.]+$/, "");

        // Classify this page for the current space. Level plan takes priority
        // over unit plan even if both exist on the same page.
        const pageKey = `${fileName}::${pageIdx}`;
        const levelPlans = pageLevelPlansMap.get(pageKey) || [];
        const unitPlans = pageUnitPlansMap.get(pageKey) || [];
        let tier = 2;
        let qualifier: string | null = null;
        if (levelPlans.length > 0) {
          tier = 0;
          if (space !== "__unassigned__") {
            const matchingLp = levelPlans.find((lp) => lp.levels.includes(space));
            qualifier = matchingLp ? space : levelPlans[0].levels[0];
          } else {
            qualifier = levelPlans[0].levels[0];
          }
        } else if (unitPlans.length > 0) {
          tier = 1;
          const matchingUnit = space !== "__unassigned__"
            ? unitPlans.find((up) => up.levels.includes(space))
            : null;
          qualifier = matchingUnit?.unitLabel ?? unitPlans[0].unitLabel;
        }

        // Bbox overlays - outline level + connected unit floor plans on the page.
        const bboxOverlays: any[] = [];
        if (space !== "__unassigned__") {
          for (const lp of levelPlans) {
            if (!lp.levels.includes(space) || !lp.bbox) continue;
            const [bx, by, bw, bh] = lp.bbox;
            bboxOverlays.push({
              id: `lvl-bbox-${pageKey}`,
              bbox: [bx / 100, by / 100, bw / 100, bh / 100] as [number, number, number, number],
              coordSpace: "normalized" as const,
              page: pageIdx,
              color: awpClassColor("Level Floor Plan"),
              label: space,
              shape: "rect" as const,
            });
          }
          for (const up of unitPlans) {
            if (!unitNamesForLevel.has(up.unitLabel) || !up.bbox) continue;
            const [bx, by, bw, bh] = up.bbox;
            bboxOverlays.push({
              id: `unit-bbox-${pageKey}-${up.unitLabel}`,
              bbox: [bx / 100, by / 100, bw / 100, bh / 100] as [number, number, number, number],
              coordSpace: "normalized" as const,
              page: pageIdx,
              color: awpClassColor("Unit Floor Plan"),
              label: up.unitLabel,
              shape: "rect" as const,
            });
          }
        }
        // Unit-plan indicator dots (mirrors FileViewerModal). Show them when
        // this page is being shown as a level plan for the space.
        const unitMarkerOverlays: any[] = [];
        if (space !== "__unassigned__" && tier === 0) {
          const uColor = awpClassColor("Unit Floor Plan");
          // Only show markers that fall inside a level bbox on this page for
          // the current space - otherwise we'd render every marker anywhere
          // on the sheet.
          const levelBoxes = levelPlans
            .filter((lp) => lp.levels.includes(space) && lp.bbox)
            .map((lp) => {
              const [bx, by, bw, bh] = lp.bbox as [number, number, number, number];
              return { x0: bx / 100, y0: by / 100, x1: (bx + bw) / 100, y1: (by + bh) / 100 };
            });
          if (levelBoxes.length > 0) {
            for (const inst of instances) {
              if (inst.awp_class_name !== "__unit_marker__") continue;
              if (inst.file_id !== fileId || inst.page_index !== pageIdx) continue;
              const inx = Number(inst.nx);
              const iny = Number(inst.ny);
              if (!Number.isFinite(inx) || !Number.isFinite(iny)) continue;
              const inside = levelBoxes.some(
                (b) => inx >= b.x0 && inx <= b.x1 && iny >= b.y0 && iny <= b.y1,
              );
              if (!inside) continue;
              unitMarkerOverlays.push({
                id: `um-${inst.id}`,
                bbox: [inx, iny, 0, 0] as [number, number, number, number],
                coordSpace: "normalized" as const,
                page: pageIdx,
                color: uColor,
                shape: "circle" as const,
              });
            }
          }
        }
        const overlaysAll = [...bboxOverlays, ...unitMarkerOverlays, ...overlays];

        const corePart = qualifier ? `p${pageIdx} · ${qualifier}` : `p${pageIdx}`;
        const tabLabel = showFileInTab ? `${shortName} · ${corePart}` : corePart;

        return {
          key,
          fileId,
          pageIdx,
          fileName,
          shortName,
          bucket,
          parentPath,
          sizeBytes,
          overlays: overlaysAll,
          tier,
          tabLabel,
        };
      })
      .filter((t): t is TabEntry => t !== null);
    const tabs = tabsUnsorted.sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      const f = a.fileName.localeCompare(b.fileName);
      if (f !== 0) return f;
      return a.pageIdx - b.pageIdx;
    });

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">{label}</h3>
        </div>
        {rows.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No objects found in this space.
          </div>
        ) : (
          <div className="relative w-full">
            <table className="w-full caption-bottom text-sm border-collapse">
              <thead className="sticky top-0 z-20 bg-background shadow-[0_1px_0_0_hsl(var(--border))]">
                <TableRow className={`${compactRow} border-b-0 hover:bg-transparent`}>
                  <TableHead className={`${compactHead} bg-background font-semibold`}>Instance ID</TableHead>
                  <TableHead className={`${compactHead} bg-background font-semibold`}>Class</TableHead>
                  {showUnitCol && <TableHead className={`${compactHead} bg-background font-semibold`}>Unit</TableHead>}
                  {showTypeCol && (
                    <TableHead className={`${compactHead} bg-background font-semibold`}>Type</TableHead>
                  )}
                  <TableHead className={`${compactHead} bg-background font-semibold`}>Annotation ID</TableHead>
                  {showDiameterCol && (
                    <TableHead className={`${compactHead} bg-background font-semibold`}>Pipe Diameter</TableHead>
                  )}
                  <TableHead className={`${compactHead} bg-background font-semibold`}>Source</TableHead>
                </TableRow>
              </thead>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={`${r.instanceId}-${i}`} className={compactRow}>
                    <TableCell className={`${compactCell} font-mono`}>{r.instanceId}</TableCell>
                    <TableCell className={compactCell}>{r.awpClassName}</TableCell>
                    {showUnitCol && (
                      <TableCell className={compactCell}>{r.unitName ?? "-"}</TableCell>
                    )}
                    {showTypeCol && (
                      <TableCell className={compactCell}>{r.pipeType ?? "-"}</TableCell>
                    )}
                    <TableCell className={`${compactCell} font-mono text-muted-foreground`}>
                      {r.annotationBaseId}
                    </TableCell>
                    {showDiameterCol && (
                      <TableCell className={compactCell}>{r.pipeDiameter ?? "-"}</TableCell>
                    )}
                    <TableCell className={`${compactCell} text-muted-foreground`}>
                      {fileNameById.get(r.fileId)} · Page {r.pageIndex}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </table>
          </div>
        )}

        {unitsList.length > 0 && (
          <div className="border rounded-md">
            <div className="px-3 py-2 border-b bg-muted/40 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Units on this level ({totalUnitCount} {totalUnitCount === 1 ? "unit" : "units"})
            </div>
            <div className="p-3 grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-xs">
              {unitsList.map((u) => (
                <div key={u.name} className="flex items-baseline gap-1.5 truncate">
                  <span className="truncate">
                    {u.name.replace(/^Template\s*-\s*/, "")}
                    {" "}
                    ({u.pages.map((p) => `p${p.pageIdx}`).join(", ")})
                    {u.count > 1 ? ` x${u.count}` : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {tabs.length > 0 && (
          <TabbedPagesBlock tabs={tabs} />
        )}
      </div>
    );
  };


  // ── Threat Report export ─────────────────────────────────────────────────
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);

  function computeSpaceExportData(space: string): ThreatReportSpace {
    const rowsForSpace = instancesForSpace(space);

    // Units derived from pageUnitPlansMap so we honor the +/- picker count.
    const unitAgg = new Map<string, { count: number; pageIdxs: Set<number> }>();
    if (space !== "__unassigned__") {
      for (const [key, ups] of pageUnitPlansMap.entries()) {
        const [, pageStr] = key.split("::");
        const pageIdx = parseInt(pageStr, 10);
        for (const up of ups) {
          const lc = up.levelsWithCounts.find((x) => x.level === space);
          if (!lc || lc.count <= 0) continue;
          const cur = unitAgg.get(up.unitLabel) || { count: 0, pageIdxs: new Set<number>() };
          cur.count += lc.count;
          cur.pageIdxs.add(pageIdx);
          unitAgg.set(up.unitLabel, cur);
        }
      }
      for (const [key, pairs] of pageSpaceUnitMap.entries()) {
        for (const pair of pairs) {
          if (pair.level !== space || !pair.unit || unitAgg.has(pair.unit)) continue;
          const [, pageStr] = key.split("::");
          unitAgg.set(pair.unit, { count: 1, pageIdxs: new Set([parseInt(pageStr, 10)]) });
        }
      }
    }
    const units = Array.from(unitAgg.entries())
      .map(([name, info]) => ({
        name,
        count: info.count,
        pageIdxs: Array.from(info.pageIdxs).sort((a, b) => a - b),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
    const unitNamesForLevel = new Set(units.map((u) => u.name));

    // No instances → omit drawings entirely from the export (per spec).
    if (rowsForSpace.length === 0) {
      return { name: space, rows: [], units, pages: [] };
    }

    // Candidate pages: annotation source pages + level plan pages for the space
    // + connected unit plan pages.
    const pageKeySet = new Set<string>();
    for (const r of rowsForSpace) pageKeySet.add(`${r.fileId}::${r.pageIndex}`);
    const addByFileNamePage = (fileName: string, pageStr: string) => {
      const lookup = sheetByFilePage.get(`${fileName}::${pageStr}`);
      const fileId = lookup?.file?.id;
      if (!fileId) return;
      pageKeySet.add(`${fileId}::${pageStr}`);
    };
    if (space !== "__unassigned__") {
      for (const [key, lps] of pageLevelPlansMap.entries()) {
        if (!lps.some((lp) => lp.levels.includes(space))) continue;
        const [fileName, pageStr] = key.split("::");
        addByFileNamePage(fileName, pageStr);
      }
      if (unitNamesForLevel.size > 0) {
        for (const [key, ups] of pageUnitPlansMap.entries()) {
          if (!ups.some((up) => unitNamesForLevel.has(up.unitLabel))) continue;
          const [fileName, pageStr] = key.split("::");
          addByFileNamePage(fileName, pageStr);
        }
      }
    }

    const uniqueFileNames = new Set(
      Array.from(pageKeySet).map((k) => fileNameById.get(k.split("::")[0]) || ""),
    );
    const showFileInTab = uniqueFileNames.size > 1;

    type Built = {
      page: ThreatReportPageRef;
      tier: 0 | 1 | 2; // 0=level plan, 1=unit plan, 2=other
      hasMarkups: boolean;
      sortKey: string;
    };
    const built: Built[] = [];

    for (const key of pageKeySet) {
      const [fileId, pageIdxStr] = key.split("::");
      const pageIdx = parseInt(pageIdxStr, 10);
      const fileName = fileNameById.get(fileId) || "";
      const lookup = sheetByFilePage.get(`${fileName}::${pageIdx}`);
      if (!lookup) continue;
      const bucket = bucketForSource(lookup.sheet.file_source_type);
      const parentPath = lookup.file.storage_path;
      const sizeBytes = (lookup.file as any).size_bytes ?? null;

      const rawOverlays = rowsForSpace.filter(
        (r) => r.fileId === fileId && r.pageIndex === pageIdx,
      );
      // Collapse markers that share the same source annotation OR the exact
      // same (nx, ny). This mirrors the in-app threat report visualization:
      // when a unit floor plan is placed multiple times in a level, every
      // duplicate of a single source annotation collapses to one marker
      // whose label lists all instance IDs on separate lines.
      const groupsByPos = new Map<string, typeof rawOverlays>();
      for (const r of rawOverlays) {
        const baseKey = r.annotationBaseId
          ? `ann::${r.annotationBaseId}`
          : `pos::${(r.nx ?? 0).toFixed(4)}::${(r.ny ?? 0).toFixed(4)}`;
        const arr = groupsByPos.get(baseKey) ?? [];
        arr.push(r);
        groupsByPos.set(baseKey, arr);
      }
      const annOverlays = Array.from(groupsByPos.values()).map((group) => {
        const r = group[0];
        const labels = group.map((g) =>
          g.pipeDiameter ? `${g.instanceId} (${g.pipeDiameter})` : g.instanceId,
        );
        return {
          id: `${r.instanceId}-${group.length}`,
          nx: r.nx ?? 0,
          ny: r.ny ?? 0,
          color: awpClassColor(r.awpClassName),
          label: labels.join("\n"),
          shape: "circle" as const,
        };
      });

      const shortName = fileName.replace(/\.[^.]+$/, "");
      const pageKey = `${fileName}::${pageIdx}`;
      const levelPlans = pageLevelPlansMap.get(pageKey) || [];
      const unitPlans = pageUnitPlansMap.get(pageKey) || [];

      const matchedLevel =
        space !== "__unassigned__"
          ? levelPlans.find((lp) => lp.levels.includes(space)) || null
          : levelPlans[0] || null;
      const matchedUnit =
        space !== "__unassigned__"
          ? unitPlans.find((up) => unitNamesForLevel.has(up.unitLabel)) || null
          : unitPlans[0] || null;

      const bboxOverlays: any[] = [];
      // Unit-plan indicator dots stored as `__unit_marker__` rows in
      // drawing_instances. FileViewerModal renders these inside the level
      // bbox to show where each unit floor plan is referenced. Mirror them
      // on the threat-report level page so the same pink dots appear.
      const unitMarkerOverlays: any[] = [];
      if (space !== "__unassigned__") {
        if (matchedLevel?.bbox) {
          const [bx, by, bw, bh] = matchedLevel.bbox;
          bboxOverlays.push({
            id: `lvl-bbox-${pageKey}`,
            nx: bx / 100, ny: by / 100, nw: bw / 100, nh: bh / 100,
            color: awpClassColor("Level Floor Plan"), label: space, shape: "rect" as const,
          });
        }
        for (const up of unitPlans) {
          if (!unitNamesForLevel.has(up.unitLabel) || !up.bbox) continue;
          const [bx, by, bw, bh] = up.bbox;
          bboxOverlays.push({
            id: `unit-bbox-${pageKey}-${up.unitLabel}`,
            nx: bx / 100, ny: by / 100, nw: bw / 100, nh: bh / 100,
            color: awpClassColor("Unit Floor Plan"), label: up.unitLabel, shape: "rect" as const,
          });
        }
        // Unit-marker dots for this file/page - only render on level-plan pages
        // (i.e. when we matched a level bbox for this space).
        if (matchedLevel?.bbox) {
          const [bx, by, bw, bh] = matchedLevel.bbox;
          const x0 = bx / 100, y0 = by / 100, x1 = (bx + bw) / 100, y1 = (by + bh) / 100;
          const uColor = awpClassColor("Unit Floor Plan");
          for (const inst of instances) {
            if (inst.awp_class_name !== "__unit_marker__") continue;
            if (inst.file_id !== fileId || inst.page_index !== pageIdx) continue;
            const inx = Number(inst.nx);
            const iny = Number(inst.ny);
            if (!Number.isFinite(inx) || !Number.isFinite(iny)) continue;
            if (inx < x0 || inx > x1 || iny < y0 || iny > y1) continue;
            unitMarkerOverlays.push({
              id: `um-${inst.id}`,
              nx: inx,
              ny: iny,
              color: uColor,
              shape: "circle" as const,
            });
          }
        }
      }

      let tier: 0 | 1 | 2 = 2;
      let qualifier: string | null = null;
      if (matchedLevel) {
        tier = 0;
        qualifier = space !== "__unassigned__" ? space : matchedLevel.levels[0];
      } else if (matchedUnit) {
        tier = 1;
        qualifier = matchedUnit.unitLabel;
      }
      const corePart = qualifier ? `p${pageIdx} · ${qualifier}` : `p${pageIdx}`;
      const tabLabel = showFileInTab ? `${shortName} · ${corePart}` : corePart;

      built.push({
        page: {
          fileName,
          shortName,
          pageIdx,
          bucket,
          parentPath,
          sizeBytes,
          overlays: [...bboxOverlays, ...unitMarkerOverlays, ...annOverlays],
          tabLabel,
        },
        tier,
        hasMarkups: annOverlays.length > 0,
        sortKey: `${fileName}::${String(pageIdx).padStart(6, "0")}`,
      });
    }

    // Pick at most ONE level plan page (prefer one with markups).
    const levelCandidates = built
      .filter((b) => b.tier === 0)
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    const levelPick =
      levelCandidates.find((b) => b.hasMarkups) ?? levelCandidates[0] ?? null;

    // Unit plan pages: only those WITH markups.
    const unitPicks = built
      .filter((b) => b.tier === 1 && b.hasMarkups)
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey));

    // Other annotation source pages (always have markups by definition).
    const otherPicks = built
      .filter((b) => b.tier === 2)
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey));

    const pages: ThreatReportPageRef[] = [
      ...(levelPick ? [levelPick.page] : []),
      ...unitPicks.map((b) => b.page),
      ...otherPicks.map((b) => b.page),
    ];

    return {
      name: space,
      rows: rowsForSpace.map((r) => ({
        instanceId: r.instanceId,
        awpClassName: r.awpClassName,
        unitName: r.unitName ?? null,
        annotationBaseId: r.annotationBaseId,
        fileName: fileNameById.get(r.fileId) || "",
        pageIndex: r.pageIndex,
        pipeDiameter: r.pipeDiameter ?? null,
        pipeType: r.pipeType ?? null,
      })),
      units,
      pages,
    };
  }

  async function handleExportClick() {
    if (exporting) return;
    setExporting(true);
    setExportProgress({ phase: "init", message: "Preparing report..." });
    try {
      const sourceDrawings = Array.from(
        new Set(fileGroups.map((g) => g.file.name)),
      );
      // Cold Water and Hot Water are split into per (Type, Diameter) virtual
      // classes so the Overview and Summary matrix show a separate row/column
      // for each combination (e.g. "Cold Water Potable 22mm").
      const isTypedClassName = (n: string) =>
        /(^|\s)(cold|hot)\s*water(\s|$)/i.test(n);
      const typeGroupOf = (r: (typeof expanded)[number]) =>
        r.pipeType && r.pipeType.trim() ? r.pipeType.trim() : "(untyped)";
      const diameterOf = (r: (typeof expanded)[number]) =>
        r.pipeDiameter && r.pipeDiameter.trim() ? r.pipeDiameter.trim() : "(no size)";
      const diameterSortKey = (d: string) => {
        if (d === "(no size)") return Number.POSITIVE_INFINITY;
        const m = d.match(/-?\d+(\.\d+)?/);
        return m ? parseFloat(m[0]) : Number.POSITIVE_INFINITY;
      };

      type ClassEntry = {
        key: string;
        canonicalName: string;
        displayName: string;
        typeGroup: string | null;
        diameter: string | null;
        idPrefix: string;
      };
      const classEntries: ClassEntry[] = classCols.flatMap((c) => {
        const base = displayClassName(c.name);
        const basePrefix = optionByName.get(c.name)?.idPrefix || "";
        if (!isTypedClassName(c.name)) {
          return [{
            key: c.name,
            canonicalName: c.name,
            displayName: base,
            typeGroup: null,
            diameter: null,
            idPrefix: basePrefix,
          }];
        }
        const combos = new Map<string, { type: string; diameter: string }>();
        for (const r of expanded) {
          if (r.awpClassName !== c.name) continue;
          if (r.category !== "Asset" && r.category !== "Water System") continue;
          const t = typeGroupOf(r);
          const d = diameterOf(r);
          combos.set(`${t}::${d}`, { type: t, diameter: d });
        }
        if (combos.size === 0) {
          return [{
            key: c.name,
            canonicalName: c.name,
            displayName: base,
            typeGroup: null,
            diameter: null,
            idPrefix: basePrefix,
          }];
        }
        return Array.from(combos.values())
          .sort((a, b) => {
            const t = a.type.localeCompare(b.type);
            if (t !== 0) return t;
            return diameterSortKey(a.diameter) - diameterSortKey(b.diameter);
          })
          .map(({ type, diameter }) => {
            const typeLabel = type === "(untyped)" ? "" : ` ${type}`;
            const typePrefix = type === "(untyped)" ? "" : `-${type}`;
            return {
              key: `${c.name}::${type}::${diameter}`,
              canonicalName: c.name,
              displayName: `${base}${typeLabel} ${diameter}`.replace(/\s+/g, " ").trim(),
              typeGroup: type,
              diameter,
              idPrefix: `${basePrefix}${typePrefix} ${diameter}`.replace(/\s+/g, " ").trim(),
            };
          });
      });

      const entryKeyForRow = (r: (typeof expanded)[number]) =>
        isTypedClassName(r.awpClassName)
          ? `${r.awpClassName}::${typeGroupOf(r)}::${diameterOf(r)}`
          : r.awpClassName;


      // Counts per entry key (with consolidated dedupe) and per (space, entry).
      const countsPerKey = new Map<string, number>();
      const spaceCountsPerKey = new Map<string, Map<string, number>>();
      const seenConsGlobal = new Set<string>();
      for (const r of expanded) {
        if (r.category !== "Asset" && r.category !== "Water System") continue;
        const key = entryKeyForRow(r);
        if (r.logicalKey.startsWith("cons::")) {
          const dedup = `${key}::${r.annotationBaseId}`;
          if (seenConsGlobal.has(dedup)) continue;
          seenConsGlobal.add(dedup);
        }
        countsPerKey.set(key, (countsPerKey.get(key) || 0) + 1);
        const space =
          r.spaceName && levelNames.has(r.spaceName) ? r.spaceName : "__unassigned__";
        const inner = spaceCountsPerKey.get(space) || new Map<string, number>();
        inner.set(key, (inner.get(key) || 0) + 1);
        spaceCountsPerKey.set(space, inner);
      }

      const overviewClasses = classEntries.map((e) => {
        // Per-attribute breakdown. Typed entries already carry Type + Diameter
        // in the row itself, so their breakdown is empty. Other classes keep
        // the combined (pipe_size, type) breakdown.
        const combos = new Map<
          string,
          { attributes: Record<string, string>; count: number }
        >();
        const seenCons = new Set<string>();
        for (const r of expanded) {
          if (entryKeyForRow(r) !== e.key) continue;
          if (r.category !== "Asset" && r.category !== "Water System") continue;
          if (r.logicalKey.startsWith("cons::")) {
            const dedup = `${e.key}::${r.annotationBaseId}`;
            if (seenCons.has(dedup)) continue;
            seenCons.add(dedup);
          }
          if (e.typeGroup) continue; // typed entry: no extra breakdown needed
          const attrs: Record<string, string> = {};
          if (r.pipeDiameter) attrs["Pipe size"] = r.pipeDiameter;
          if (r.pipeType) attrs["Type"] = r.pipeType;
          if (Object.keys(attrs).length === 0) continue;
          const key = JSON.stringify(attrs);
          const cur = combos.get(key);
          if (cur) cur.count += 1;
          else combos.set(key, { attributes: attrs, count: 1 });
        }

        return {
          name: e.displayName,
          idPrefix: e.idPrefix,
          count: countsPerKey.get(e.key) || 0,
          breakdown: Array.from(combos.values()).sort((a, b) => b.count - a.count),
        };
      });
      const summary = {
        spaces: spaceList,
        classes: classEntries.map((e) => ({
          name: e.displayName,
          idPrefix: e.idPrefix,
        })),
        matrix: Object.fromEntries(
          spaceList.map((s) => [
            s,
            Object.fromEntries(
              classEntries.map((e) => [
                e.displayName,
                spaceCountsPerKey.get(s)?.get(e.key) || 0,
              ]),
            ),
          ]),
        ),
      };

      const spacesData = spaceList.map((s) => {
        const sp = computeSpaceExportData(s);
        return {
          ...sp,
          rows: sp.rows.map((r) => ({
            ...r,
            awpClassName: displayClassName(r.awpClassName),
          })),
        };
      });
      const payload: ThreatReportPayload = {
        projectId,
        analysisRequestId: requestId ?? null,
        projectName,
        reportDate: new Date().toLocaleDateString(undefined, {
          year: "numeric",
          month: "long",
          day: "numeric",
        }),
        sourceDrawings,
        overviewClasses,
        summary,
        spaces: spacesData,
      };
      await runThreatReportExport(payload, (p) => setExportProgress(p));
      toast({
        title: "Report ready",
        description: "Sent an email with a link to download the report.",
      });

    } catch (err: any) {
      console.error("[threat-report-export]", err);
      toast({
        title: "Export failed",
        description: err?.message || "Could not generate the report.",
        variant: "destructive",
      });
    } finally {
      setExporting(false);
      setExportProgress(null);
    }
  }

  const renderRight = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center p-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      );
    }
    if (selected === "__overview__") return renderOverview();
    if (selected === "__summary__") return renderSummary();
    return renderSpaceDetail(selected);
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[95vw] sm:max-w-[95vw]">
        <DialogHeader>
          <DialogTitle>Threat Report</DialogTitle>
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
              onClick={handleExportClick}
              disabled={exporting}
            >
              {exporting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
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
    <PreparingReportModal open={exporting} progress={exportProgress} />
    </>
  );
}

// ---------------------------------------------------------------------------
// PreparingReportModal - shown while threat report export is generating.
// ---------------------------------------------------------------------------
function PreparingReportModal({
  open,
  progress,
}: {
  open: boolean;
  progress: ExportProgress | null;
}) {
  const pct =
    progress?.total && progress.total > 0
      ? Math.round(((progress.current ?? 0) / progress.total) * 100)
      : null;
  return (
    <Dialog open={open}>
      <DialogContent
        className="max-w-md"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Preparing report</DialogTitle>
          <DialogDescription>
            We're getting your report ready to go. It should be finished in just a moment.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3 py-2">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <div className="flex-1">
            <div className="text-sm">
              {progress?.message || "Working..."}
            </div>
            {pct !== null && (
              <div className="mt-2 h-1.5 w-full rounded bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Please keep this tab open until the upload finishes. You'll receive an
          email with a download link as soon as the report is ready.
        </p>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// TabbedPagesBlock - renders multiple (file, page) sources as tabs over a
// single DrawingPageBlock. The parent PDF is downloaded once per file and
// page navigation happens inside DrawingViewer (same approach as the drawing
// modal), so switching between pages of the same file is instant.
// ---------------------------------------------------------------------------
function TabbedPagesBlock({
  tabs,
}: {
  tabs: Array<{
    key: string;
    fileName: string;
    shortName: string;
    pageIdx: number;
    bucket: string;
    parentPath: string | null;
    sizeBytes?: number | null;
    overlays: any[];
    tabLabel?: string;
  }>;
}) {
  const [activeKey, setActiveKey] = useState<string>(tabs[0]?.key ?? "");
  useEffect(() => {
    if (!tabs.find((t) => t.key === activeKey)) {
      setActiveKey(tabs[0]?.key ?? "");
    }
  }, [tabs, activeKey]);
  const active = tabs.find((t) => t.key === activeKey) ?? tabs[0];
  if (!active) return null;

  return (
    <div className="border rounded-md overflow-hidden">
      <div>
        {active.parentPath ? (
          <DrawingPageBlock
            key={active.key}
            fileName={active.fileName}
            pageIdx={active.pageIdx}
            source={{
              kind: "supabase-storage",
              bucket: active.bucket,
              path: active.parentPath,
              mimeType: "application/pdf",
              version: active.sizeBytes ?? undefined,
            }}
            overlays={active.overlays}
            page={active.pageIdx}
            customSelector={
              tabs.length > 1 ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-muted-foreground whitespace-nowrap">Drawing:</span>
                  <Select value={activeKey} onValueChange={setActiveKey}>
                    <SelectTrigger className="h-8 text-xs w-auto min-w-[220px] max-w-full bg-background border-muted-foreground/30">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {tabs.map((t) => (
                        <SelectItem key={t.key} value={t.key} className="text-xs">
                          {t.tabLabel ?? `${t.shortName} · p${t.pageIdx}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null
            }
          />
        ) : (
          <div className="p-4 text-xs text-muted-foreground">
            {active.fileName} · Page {active.pageIdx} (drawing not available)
          </div>
        )}
      </div>
    </div>
  );
}



// ---------------------------------------------------------------------------
// DrawingPageBlock - renders a single drawing page in the Instances Report
// with a docked header (file name + Download button) and a non-interactive
// DrawingViewer. The Download button rasterizes the page (including markers)
// to PNG via html2canvas.
// ---------------------------------------------------------------------------
function DrawingPageBlock({
  fileName,
  pageIdx,
  source,
  overlays,
  page,
  customSelector,
}: {
  fileName: string;
  pageIdx: number;
  source: DocumentSourceDescriptor;
  overlays: any[];
  page?: number;
  customSelector?: React.ReactNode;
}) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const [downloading, setDownloading] = useState(false);
  // Lazy-mount the DrawingViewer only when this block scrolls near the
  // viewport. Renders dozens of pages in the Threat Report at once would
  // otherwise hammer the main thread with simultaneous pdf.js rasterization.
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const node = containerRef.current;
    if (!node || inView) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setInView(true);
            io.disconnect();
            break;
          }
        }
      },
      { rootMargin: "400px 0px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [inView]);

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
    <div ref={containerRef} className="border rounded-md overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-muted/40 border-b">
        {customSelector ? (
          customSelector
        ) : (
          <div className="text-sm font-semibold truncate">
            {fileName} · Page {pageIdx}
          </div>
        )}
        <Button size="sm" variant="outline" onClick={handleDownload} disabled={downloading || !inView}>
          {downloading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
          ) : (
            <Download className="h-3.5 w-3.5 mr-1.5" />
          )}
          Download
        </Button>
      </div>
      <div ref={surfaceRef} className="w-full aspect-[3/2] bg-white">
        {inView ? (
          <DrawingViewer
            source={source}
            page={page ?? 1}
            overlays={overlays}
            showToolbar={false}
            interactive={false}
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>
    </div>
  );
}

