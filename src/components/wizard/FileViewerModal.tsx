import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  ChevronDown,
  ChevronRight,
  GripVertical,
  Loader2,
  Pencil,
  Plus,
  Redo2,
  Undo2,
} from "lucide-react";
import { DrawingViewer } from "@/components/viewer";
import type {
  DocumentSourceDescriptor,
  OverlayInput,
} from "@/components/viewer";
import { inverseRotateNormalizedRect } from "@/components/viewer/viewerGeometry";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { X as XIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { getUserFriendlyError } from "@/lib/errorHandling";
import { awpClassColor, awpClassColorForType, readableTextOn, softBgFrom } from "@/lib/awpColor";


import {
  type ParsedFloorPlan,
  floorPlanDisplayLabel,
  unitPlanRefKey,
  getEffectiveBbox,
  getEffectiveLabel,
  getEffectiveType,
} from "@/lib/surveyFloorPlans";
import { AnnotationMetadataPopover } from "@/components/wizard/AnnotationMetadataPopover";
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
import { Input } from "@/components/ui/input";


interface SystemDetection {
  lineMonitored: string;
  lineCode: string;
  systemType: string;
  coordinates: [number, number, number, number];
  fileName?: string;
}

export interface AwpClassOption {
  name: string;
  prefix: string | null;
  /** Triage count derived from analysis (per file for this drawing). */
  analysisCount: number;
}

interface DrawingInstanceRow {
  id: string;
  awp_class_name: string;
  nx: number;
  ny: number;
  page_index: number;
  file_id: string;
  created_at: string;
  instance_number: number | null;
  metadata: Record<string, any> | null;
}

// Classes that support the pipe-diameter metadata popover.
// Matched as a case-insensitive substring against the class name.
// Pipe size is optional for Cold Water, Hot Water, and Fire Suppression System.
const DIAMETER_ENABLED_MATCHERS = [
  "cold water",
  "hot water",
  "fire suppression",
];
const isDiameterEnabledClass = (name: string): boolean => {
  const n = (name || "").toLowerCase();
  return DIAMETER_ENABLED_MATCHERS.some((m) => n.includes(m));
};

// Type is optional for Cold Water and Hot Water only.
const isTypeEnabledClass = (name: string): boolean => {
  const n = (name || "").toLowerCase();
  return n.includes("cold water") || n.includes("hot water");
};

// Metadata field descriptors surfaced in the annotation popover, keyed by
// class. Each entry lists the metadata keys to render as separate inputs.
// Type is intentionally listed before Pipe size so it shows as the first tab.
interface MetaFieldDef {
  key: string;
  label: string;
  placeholder: string;
}
const metaFieldsForClass = (name: string): MetaFieldDef[] => {
  const out: MetaFieldDef[] = [];
  if (isTypeEnabledClass(name)) {
    out.push({
      key: "pipe_type",
      label: "Type",
      placeholder: "Type (e.g. PEX, Copper)",
    });
  }
  if (isDiameterEnabledClass(name)) {
    out.push({
      key: "pipe_diameter",
      label: "Pipe size",
      placeholder: 'Diameter (e.g. 50mm, 3/4")',
    });
  }
  return out;
};

// Sentinel awp_class_name used for lightweight "unit floor plan" indicator
// dots placed inside a level-plan bbox. These are not tied to any specific
// unit reference and are excluded from the normal detections lists.
const UNIT_MARKER_CLASS = "__unit_marker__";

interface FileViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  fileId: string;
  fileName: string;
  mimeType: string;
  accessToken: string;
  detections: SystemDetection[];
  sourceOverride?: DocumentSourceDescriptor;
  /** Optional original source used by the page-download action. */
  downloadSourceOverride?: DocumentSourceDescriptor;
  /** Optional 1-based source page used by the page-download action. */
  downloadPageOverride?: number;
  // --- Workbench enhancements ---
  awpClasses?: AwpClassOption[];
  analysisRequestId?: string;
  parentFileId?: string;
  sheetId?: string | null;
  pageIndex?: number;
  /** Map of file_id → file name. Required when awpClasses is provided so
   *  global instance numbering can order by drawing file name. */
  fileNameById?: Record<string, string>;
  /** Notified after any user marker is added or removed. */
  onInstancesChanged?: () => void;
  /** Optional key (e.g. project id) used to persist the selected AWP class
   *  in localStorage across modal openings and browser sessions. */
  persistKey?: string;
  /** Controlled expanded-class set. When provided, expand/collapse state is
   *  owned by the parent so it survives modal open/close cycles. */
  expandedClasses?: Set<string>;
  onExpandedClassesChange?: (next: Set<string>) => void;
  /** When provided, the radio for this class is selected each time the
   *  modal opens. Useful when the modal is launched by clicking a class
   *  cell in a grid. The value changing also re-selects (so re-opens with a
   *  different class force-select correctly). */
  preselectClass?: string | null;
  /** Optional element rendered next to the title (e.g. a space badge). */
  titleAccessory?: React.ReactNode;
  /** When true, lock the viewer to `pageIndex` and disable page navigation
   *  (the full multi-page PDF is still loaded, but only this page is shown). */
  singlePageOnly?: boolean;
  /** Floor-plan items for the current page (parsed from survey response). */
  floorPlans?: ParsedFloorPlan[];
  /** All unit_floor_plan items across the parent file, used as the "Add unit" picker. */
  allUnitPlans?: ParsedFloorPlan[];
  /** All level_floor_plan items across the parent file, used to show where a unit is referenced. */
  allLevelPlans?: ParsedFloorPlan[];
  /** Per-plan user overrides keyed by plan_id. */
  floorPlanOverrides?: Record<string, { floors?: string[]; units?: string[] }>;
  /** File-wide level-plan overrides (across all pages) used to compute the
   *  "Referenced in" hint for unit floor plans on the active page. */
  allLevelPlanOverrides?: Record<string, { units?: string[] }>;

  /** Persist a single plan override. */
  onSaveFloorPlanOverride?: (
    planId: string,
    next: {
      floors?: string[];
      units?: string[];
      annotations?: string[];
      bbox_pct?: [number, number, number, number] | null;
      name?: string | null;
      type?: string | null;
    },
  ) => Promise<void> | void;
  /** Page-level handler that opens SpaceEditModal scoped to a plan. */
  onEditFloors?: (planId: string, currentFloors: string[]) => void;
  /** @deprecated Replaced by inline popover; kept for API compat. */
  onEditLevelUnits?: (plan: ParsedFloorPlan, currentUnits: string[]) => void;
  /** Save units for a level plan. createdRefs = newly-typed refs to persist
   *  as __added_unit_plans entries. removedRefs = previously-saved refs that
   *  should also be removed from __added_unit_plans (when present there). */
  onSaveLevelUnits?: (
    plan: ParsedFloorPlan,
    units: string[],
    createdRefs?: string[],
    removedRefs?: string[],
  ) => Promise<void> | void;
  /** Delete a floor plan entirely (parsed plans go to `__deleted_plan_ids`,
   *  added unit plans are removed from `__added_unit_plans`). */
  onDeletePlan?: (planId: string) => Promise<void> | void;
  /** Add a manually-created floor plan with a default bounding box. */
  onAddPlan?: (args: {
    type: "level_floor_plan" | "unit_floor_plan";
    name: string;
    bbox_pct: [number, number, number, number];
  }) => Promise<void> | void;
  /** AWP class names that have risk_element_results for this file. */
  riskElementClasses?: string[];
  /** @deprecated - assignments are no longer used. Kept for API compat. */
  annotationAssignments?: Record<string, string>;
  /** @deprecated - assignments are no longer used. Kept for API compat. */
  onAssignAnnotation?: (className: string, planId: string | null) => Promise<void> | void;
  /** When true, disable placement of detections and any floor-plan editing. */
  readOnly?: boolean;
}


const BOUNDING_BOX_COLOR = "#39FF14"; // legacy detections (green)

type HistoryAction =
  | { type: "add"; instance: DrawingInstanceRow }
  | { type: "delete"; instance: DrawingInstanceRow };


export const FileViewerModal = ({
  isOpen,
  onClose,
  fileId,
  fileName,
  mimeType,
  accessToken,
  detections,
  sourceOverride,
  downloadSourceOverride,
  downloadPageOverride,
  awpClasses,
  analysisRequestId,
  parentFileId,
  sheetId,
  pageIndex = 1,
  fileNameById,
  onInstancesChanged,
  persistKey,
  expandedClasses,
  onExpandedClassesChange,
  preselectClass,
  titleAccessory,
  singlePageOnly = false,
  floorPlans,
  allUnitPlans,
  allLevelPlans,
  floorPlanOverrides,
  allLevelPlanOverrides,
  onSaveFloorPlanOverride,
  onEditFloors,
  onEditLevelUnits,

  onSaveLevelUnits,
  onDeletePlan,
  onAddPlan,
  riskElementClasses,
  annotationAssignments,
  onAssignAnnotation,
  readOnly = false,
}: FileViewerModalProps) => {

  const { toast } = useToast();
  const [hoveredCode, setHoveredCode] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(pageIndex);
  const [renderedPageSize, setRenderedPageSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);
  const [downloadIncludeOverlays, setDownloadIncludeOverlays] = useState(true);
  const [downloadBusy, setDownloadBusy] = useState(false);

  // Tracks whether OverlayLayer's label-placement optimizer is currently
  // running. Placement is deferred to a microtask on the interactive
  // viewer (see OverlayLayer.syncPlacement), so pages with many annotations
  // no longer block paint — but until it finishes, the side-panel lists can
  // read stale data if the user starts renaming/deleting. Show a spinner +
  // skim over the panels and disable pointer events while it's true.
  const [isPlacingLabels, setIsPlacingLabels] = useState(false);

  // Per-page rotation persisted on analysis_request_files.page_rotations
  const [rotationByPage, setRotationByPage] = useState<Record<number, 0 | 90 | 180 | 270>>({});
  const rotationLatestRef = useRef<Record<number, 0 | 90 | 180 | 270>>({});
  const rotationDirtyRef = useRef(false);
  const rotationTimerRef = useRef<number | null>(null);

  // Load rotations when file changes / modal opens
  useEffect(() => {
    if (!isOpen || !fileId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from("analysis_request_files")
          .select("page_rotations")
          .eq("id", fileId)
          .maybeSingle();
        if (cancelled) return;
        const raw = (data?.page_rotations ?? {}) as Record<string, number>;
        const norm: Record<number, 0 | 90 | 180 | 270> = {};
        for (const [k, v] of Object.entries(raw)) {
          const n = ((Number(v) || 0) % 360 + 360) % 360;
          if (n === 90 || n === 180 || n === 270) norm[Number(k)] = n as 90 | 180 | 270;
        }
        setRotationByPage(norm);
        rotationLatestRef.current = norm;
        rotationDirtyRef.current = false;
      } catch {
        /* ignore — non-blocking */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, fileId]);

  const flushRotations = useCallback(async () => {
    if (!fileId || !rotationDirtyRef.current) return;
    const payload = { ...rotationLatestRef.current };
    // Strip zeros to keep the map compact.
    const compact: Record<string, number> = {};
    for (const [k, v] of Object.entries(payload)) if (v) compact[k] = v;
    try {
      await supabase
        .from("analysis_request_files")
        .update({ page_rotations: compact })
        .eq("id", fileId);
      rotationDirtyRef.current = false;
    } catch {
      /* keep dirty so a later flush retries */
    }
  }, [fileId]);

  const scheduleRotationFlush = useCallback(() => {
    if (rotationTimerRef.current) window.clearTimeout(rotationTimerRef.current);
    rotationTimerRef.current = window.setTimeout(() => {
      rotationTimerRef.current = null;
      void flushRotations();
    }, 500);
  }, [flushRotations]);

  const handleRotate = useCallback(() => {
    const cur = rotationByPage[currentPage] ?? 0;
    const next = ((cur + 90) % 360) as 0 | 90 | 180 | 270;
    const nextMap = { ...rotationByPage, [currentPage]: next };
    setRotationByPage(nextMap);
    rotationLatestRef.current = nextMap;
    rotationDirtyRef.current = true;
    scheduleRotationFlush();
  }, [rotationByPage, currentPage, scheduleRotationFlush]);

  // Save on beforeunload (tab close) using keepalive
  useEffect(() => {
    const onBeforeUnload = () => {
      if (!rotationDirtyRef.current) return;
      // Fire-and-forget; supabase-js runs fetch under the hood.
      void flushRotations();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [flushRotations]);

  // Cleanup / best-effort save on unmount
  useEffect(() => {
    return () => {
      if (rotationTimerRef.current) window.clearTimeout(rotationTimerRef.current);
      if (rotationDirtyRef.current) void flushRotations();
    };
  }, [flushRotations]);

  // Keep currentPage in sync with the requested pageIndex when the modal opens
  // or when the parent changes the target page.
  useEffect(() => {
    setCurrentPage(pageIndex);
    setRenderedPageSize(null);
  }, [pageIndex, fileId]);


  const sidebarEnabled =
    !readOnly && !!awpClasses && !!analysisRequestId && !!parentFileId;

  const storageKey = persistKey ? `workbench-awp-class:${persistKey}` : null;

  const readStoredClass = useCallback((): string | null => {
    if (!storageKey || typeof window === "undefined") return null;
    try {
      return window.localStorage.getItem(storageKey);
    } catch {
      return null;
    }
  }, [storageKey]);

  const [selectedClass, setSelectedClass] = useState<string | null>(() => {
    const stored = (() => {
      if (!persistKey || typeof window === "undefined") return null;
      try {
        return window.localStorage.getItem(`workbench-awp-class:${persistKey}`);
      } catch {
        return null;
      }
    })();
    if (stored && awpClasses?.some((c) => c.name === stored)) return stored;
    return awpClasses?.[0]?.name ?? null;
  });
  // Internal expanded set, used only when parent doesn't provide one.
  const [localExpanded, setLocalExpanded] = useState<Set<string>>(
    () => new Set((awpClasses || []).map((c) => c.name)),
  );
  const expanded = expandedClasses ?? localExpanded;
  const setExpanded = (updater: (prev: Set<string>) => Set<string>) => {
    const next = updater(expanded);
    if (onExpandedClassesChange) onExpandedClassesChange(next);
    else setLocalExpanded(next);
  };
  const [instances, setInstances] = useState<DrawingInstanceRow[]>([]);
  const [loadingInstances, setLoadingInstances] = useState(false);
  const [past, setPast] = useState<HistoryAction[]>([]);
  const [future, setFuture] = useState<HistoryAction[]>([]);

  // ---- Floor-plan bbox editor state --------------------------------------
  type EditingPlanState = {
    planId: string;
    bbox: [number, number, number, number]; // pct 0..100
    name: string;
    type: string;
    origBbox: [number, number, number, number];
    origName: string;
    origType: string;
  };
  const [editingPlan, setEditingPlan] = useState<EditingPlanState | null>(null);
  const editingPlanRef = useRef<EditingPlanState | null>(null);
  useEffect(() => { editingPlanRef.current = editingPlan; }, [editingPlan]);
  const ACTIVE_TAB_STORAGE_KEY = "fileViewer.activeTab";
  const [activeTab, setActiveTab] = useState<"floor-plans" | "detections">(() => {
    if (typeof window === "undefined") return "floor-plans";
    const stored = window.localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
    return stored === "detections" || stored === "floor-plans" ? stored : "floor-plans";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, activeTab);
  }, [activeTab]);
  const [confirmExit, setConfirmExit] = useState<null | {
    kind: "tab" | "close";
    next: () => void;
  }>(null);
  const [confirmDelete, setConfirmDelete] = useState<null | { planId: string; label: string }>(null);
  const viewerApiRef = useRef<any>(null);
  const viewerContainerRef = useRef<HTMLDivElement>(null);
  // Type most recently applied to a plan in this session; new plans default
  // to it so users don't have to reset the toggle between adds.
  const lastPlanTypeRef = useRef<"level_floor_plan" | "unit_floor_plan">(
    "level_floor_plan",
  );
  // When a user just added a plan, we remember its (name, type) here so the
  // effect below can find the resulting plan_id once the parent re-renders
  // with the new floorPlans array - then automatically enter edit mode +
  // focus/select the name input.
  const pendingNewPlanRef = useRef<
    | {
        name: string;
        type: "level_floor_plan" | "unit_floor_plan";
      }
    | null
  >(null);
  const [focusNamePlanId, setFocusNamePlanId] = useState<string | null>(null);
  // Placement mode has been removed: clicking "Place Unit Floor Plan Marker"
  // now drops a single marker at the center of the level bbox immediately,
  // and users can drag or click-to-delete each dot individually.
  // Metadata popover for DCW / Fire Suppression annotations (pipe diameter).
  const [metadataDialog, setMetadataDialog] = useState<null | {
    instanceId: string;
    anchor: { x: number; y: number };
  }>(null);
  // When the metadata popover dismisses via an outside mousedown, the same
  // pointerup then fires on the document surface and would create a new
  // marker. Skip canvas clicks for a short window after any popover close.
  const suppressCanvasClickUntilRef = useRef(0);
  const closeMetadataDialog = useCallback(() => {
    suppressCanvasClickUntilRef.current = Date.now() + 350;
    setMetadataDialog(null);
  }, []);

  const effectiveFloorPlanOverrides = useMemo(() => {
    if (!editingPlan) return floorPlanOverrides ?? {};
    return {
      ...(floorPlanOverrides ?? {}),
      [editingPlan.planId]: {
        ...((floorPlanOverrides ?? {}) as any)[editingPlan.planId],
        bbox_pct: editingPlan.bbox,
        name: editingPlan.name.trim() || null,
        type: editingPlan.type,
      },
    };
  }, [floorPlanOverrides, editingPlan]);

  const isEditingDirty = !!(
    editingPlan &&
    (editingPlan.name !== editingPlan.origName ||
      editingPlan.type !== editingPlan.origType ||
      editingPlan.bbox.some((v, i) => v !== editingPlan.origBbox[i]))
  );

  // Reset editor state when modal closes or page changes. Do NOT reset
  // activeTab here - we want it preserved across modal opens.
  useEffect(() => {
    if (!isOpen) {
      setEditingPlan(null);
      setConfirmExit(null);
      setConfirmDelete(null);
      
    }
  }, [isOpen]);
  useEffect(() => {
    setEditingPlan(null);
  }, [currentPage, fileId]);

  const savePlanEdit = useCallback(async () => {
    const cur = editingPlanRef.current;
    if (!cur || !onSaveFloorPlanOverride) return;
    if (cur.type === "level_floor_plan" || cur.type === "unit_floor_plan") {
      lastPlanTypeRef.current = cur.type;
    }
    await onSaveFloorPlanOverride(cur.planId, {
      bbox_pct: cur.bbox,
      name: cur.name.trim() || null,
      type: cur.type,
    });
    setEditingPlan(null);
  }, [onSaveFloorPlanOverride]);

  const enterPlanEdit = useCallback(
    async (fp: ParsedFloorPlan) => {
      // If another row is being edited, auto-save it first.
      const prev = editingPlanRef.current;
      if (prev && prev.planId !== fp.plan_id) {
        if (
          prev.name !== prev.origName ||
          prev.type !== prev.origType ||
          prev.bbox.some((v, i) => v !== prev.origBbox[i])
        ) {
          await savePlanEdit();
        }
      } else if (prev && prev.planId === fp.plan_id) {
        return;
      }
      const bb = getEffectiveBbox(fp, floorPlanOverrides ?? {}) ?? [25, 25, 50, 50];
      const name = getEffectiveLabel(fp, floorPlanOverrides ?? {});
      const ovrType = (floorPlanOverrides as any)?.[fp.plan_id]?.type;
      const type = (typeof ovrType === "string" && ovrType) ? ovrType : fp.type || "level_floor_plan";
      const state: EditingPlanState = {
        planId: fp.plan_id,
        bbox: [bb[0], bb[1], bb[2], bb[3]],
        name,
        type,
        origBbox: [bb[0], bb[1], bb[2], bb[3]],
        origName: name,
        origType: type,
      };
      setEditingPlan(state);
      // Conditional auto-scroll: only if the bbox is completely off-screen.
      requestAnimationFrame(() => {
        const surface = document.querySelector("[data-doc-surface]") as HTMLElement | null;
        const cont = viewerContainerRef.current;
        if (!surface || !cont || !viewerApiRef.current) return;
        const sr = surface.getBoundingClientRect();
        const cr = cont.getBoundingClientRect();
        const bx = sr.left + (bb[0] / 100) * sr.width;
        const by = sr.top + (bb[1] / 100) * sr.height;
        const bw = (bb[2] / 100) * sr.width;
        const bh = (bb[3] / 100) * sr.height;
        const intersects = !(
          bx + bw < cr.left ||
          bx > cr.right ||
          by + bh < cr.top ||
          by > cr.bottom
        );
        if (!intersects) {
          viewerApiRef.current.fitToRect?.(
            {
              nx: bb[0] / 100,
              ny: bb[1] / 100,
              nw: bb[2] / 100,
              nh: bb[3] / 100,
            },
            { paddingRatio: 0.4, animate: true },
          );
        }
      });
    },
    [floorPlanOverrides, savePlanEdit],
  );

  const cancelPlanEdit = useCallback(() => setEditingPlan(null), []);

  // 50%-of-viewport bbox centered on the current pan/zoom, clamped to page.
  // NOTE: `getVisibleRect` returns coordinates in the *rotated* display
  // space (that's what the viewer's transform operates on). Persisted bbox
  // coordinates live in the *source* (unrotated) page space — overlays are
  // rotated for display via `rotateNormalizedRect`. So when the drawing is
  // rotated (90/180/270), we must invert-rotate the visible rect before
  // deriving the centered bbox, otherwise the new box spawns far outside
  // the visible viewport.
  const computeCenteredBboxPct = useCallback((): [number, number, number, number] => {
    const visibleDisplay = viewerApiRef.current?.getVisibleRect?.() as
      | { nx: number; ny: number; nw: number; nh: number }
      | null
      | undefined;
    let bbox_pct: [number, number, number, number] = [30, 30, 40, 40];
    if (visibleDisplay && Number.isFinite(visibleDisplay.nw) && Number.isFinite(visibleDisplay.nh)) {
      const rot = (rotationByPage[currentPage] ?? 0) as 0 | 90 | 180 | 270;
      const visible = rot === 0
        ? visibleDisplay
        : inverseRotateNormalizedRect(visibleDisplay, rot);
      const cx = visible.nx + visible.nw / 2;
      const cy = visible.ny + visible.nh / 2;
      const w = Math.max(0.05, Math.min(0.9, visible.nw * 0.5));
      const h = Math.max(0.05, Math.min(0.9, visible.nh * 0.5));
      let x = cx - w / 2;
      let y = cy - h / 2;
      x = Math.max(0, Math.min(1 - w, x));
      y = Math.max(0, Math.min(1 - h, y));
      bbox_pct = [x * 100, y * 100, w * 100, h * 100];
    }
    return bbox_pct;
  }, [rotationByPage, currentPage]);

  const handleAddPlan = useCallback(async () => {
    if (!onAddPlan) return;
    // Auto-save any in-progress edit first so its bbox/name/type persist
    // before we hand editing off to the newly-added plan.
    const prev = editingPlanRef.current;
    if (prev) {
      await savePlanEdit();
    }
    // Default name: "New Floor Plan N" where N is next index among existing.
    const existingNames = (floorPlans ?? []).map((fp) =>
      getEffectiveLabel(fp, floorPlanOverrides ?? {}),
    );
    let n = 1;
    while (existingNames.includes(`New Floor Plan ${n}`)) n++;
    const name = `New Floor Plan ${n}`;
    const type = lastPlanTypeRef.current;
    const bbox_pct = computeCenteredBboxPct();
    pendingNewPlanRef.current = { name, type };
    await onAddPlan({ type, name, bbox_pct });
  }, [onAddPlan, floorPlans, floorPlanOverrides, savePlanEdit, computeCenteredBboxPct]);

  // Handler is defined further below, after `dbInsert` and `effectivePage`
  // are in scope. We forward-declare via a mutable ref so the sidebar can
  // invoke it without running into TDZ ordering issues.
  const handleStartUnitMarkerPlacementRef = useRef<
    ((planId: string) => Promise<void>) | null
  >(null);
  const handleStartUnitMarkerPlacement = useCallback(
    async (planId: string) => {
      const fn = handleStartUnitMarkerPlacementRef.current;
      if (fn) await fn(planId);
    },
    [],
  );

  // Once the parent has committed the new plan, floorPlans will contain it.
  // Find it by name+type match, enter edit mode, and flag the row for the
  // input to autofocus + select all.
  useEffect(() => {
    const pending = pendingNewPlanRef.current;
    if (!pending || !floorPlans || floorPlans.length === 0) return;
    const match = floorPlans.find((fp) => {
      const label = getEffectiveLabel(fp, floorPlanOverrides ?? {});
      return label === pending.name;
    });
    if (!match) return;
    pendingNewPlanRef.current = null;
    setFocusNamePlanId(match.plan_id);
    void enterPlanEdit(match);
  }, [floorPlans, floorPlanOverrides, enterPlanEdit]);

  // Guard tab/close transitions when there are unsaved edits.
  const guardThen = useCallback(
    (kind: "tab" | "close", next: () => void) => {
      if (editingPlan && isEditingDirty) {
        setConfirmExit({ kind, next });
      } else {
        setEditingPlan(null);
        next();
      }
    },
    [editingPlan, isEditingDirty],
  );



  // Reset history on open. Selected class is re-synced from localStorage.
  // Expansion state is NOT reset - it should persist across modal opens
  // (and, when a parent provides expandedClasses, across page sessions too).
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setPast([]);
      setFuture([]);
      // Preselect takes priority over stored class so cell-click force-selects.
      if (preselectClass && awpClasses?.some((c) => c.name === preselectClass)) {
        setSelectedClass(preselectClass);
      } else {
        const stored = readStoredClass();
        const next =
          stored && awpClasses?.some((c) => c.name === stored)
            ? stored
            : awpClasses?.[0]?.name ?? null;
        setSelectedClass(next);
      }
    }
    wasOpenRef.current = isOpen;
  }, [isOpen, awpClasses, readStoredClass, preselectClass]);

  // Auto-expand newly-arriving classes so they default to expanded.
  // Track which class names we've already auto-expanded so user-collapsed
  // classes don't get re-expanded on every render when the awpClasses prop
  // reference changes.
  const autoExpandedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!awpClasses || awpClasses.length === 0) return;
    const seen = autoExpandedRef.current;
    const fresh = awpClasses.map((c) => c.name).filter((n) => !seen.has(n));
    if (fresh.length === 0) return;
    for (const n of fresh) seen.add(n);
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const n of fresh) next.add(n);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awpClasses]);


  // Persist selected class to localStorage whenever it changes.
  useEffect(() => {
    if (!storageKey || !selectedClass || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey, selectedClass);
    } catch {
      // ignore
    }
  }, [storageKey, selectedClass]);

  useEffect(() => {
    if (isOpen && awpClasses && awpClasses.length > 0 && !selectedClass) {
      setSelectedClass(awpClasses[0].name);
    }
  }, [isOpen, awpClasses, selectedClass]);

  // Load instances for the entire analysis request (needed for global numbering)
  useEffect(() => {
    if (!isOpen || !sidebarEnabled) return;
    let cancelled = false;
    (async () => {
      setLoadingInstances(true);
      const { data, error } = await supabase
        .from("drawing_instances" as any)
        .select("id, awp_class_name, nx, ny, page_index, file_id, created_at, instance_number, metadata")
        .eq("analysis_request_id", analysisRequestId!)
        .order("created_at", { ascending: true });
      if (!cancelled) {
        if (error) {
          toast({
            variant: "destructive",
            title: "Could not load markers",
            description: getUserFriendlyError(error),
          });
        }
        setInstances(((data as unknown) as DrawingInstanceRow[]) || []);
        setLoadingInstances(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, sidebarEnabled, analysisRequestId, toast]);

  // ---- DB helpers (do not touch history) -----------------------------------
  const dbInsert = useCallback(
    async (
      args: { awp_class_name: string; nx: number; ny: number; page_index: number },
    ): Promise<DrawingInstanceRow | null> => {
      // Persistent numbering: next number = max existing for this
      // (analysis_request, class) + 1. Deletes do NOT renumber, so the next
      // added marker continues past the highest existing ID.
      const maxNum = instances
        .filter((i) => i.awp_class_name === args.awp_class_name)
        .reduce((m, i) => Math.max(m, i.instance_number ?? 0), 0);
      const nextNum = maxNum + 1;
      const { data, error } = await supabase
        .from("drawing_instances" as any)
        .insert({
          analysis_request_id: analysisRequestId!,
          file_id: parentFileId!,
          sheet_id: sheetId ?? null,
          instance_number: nextNum,
          ...args,
        } as any)
        .select("id, awp_class_name, nx, ny, page_index, file_id, created_at, instance_number, metadata")
        .single();
      if (error) {
        toast({
          variant: "destructive",
          title: "Could not save marker",
          description: getUserFriendlyError(error),
        });
        return null;
      }
      onInstancesChanged?.();
      return (data as unknown) as DrawingInstanceRow;
    },
    [analysisRequestId, parentFileId, sheetId, toast, onInstancesChanged, instances],
  );

  const dbDelete = useCallback(
    async (id: string): Promise<boolean> => {
      const { error } = await supabase
        .from("drawing_instances" as any)
        .delete()
        .eq("id", id);
      if (error) {
        toast({
          variant: "destructive",
          title: "Could not delete marker",
          description: getUserFriendlyError(error),
        });
        return false;
      }
      onInstancesChanged?.();
      return true;
    },
    [toast, onInstancesChanged],
  );

  const dbUpdateMetadata = useCallback(
    async (id: string, metadata: Record<string, any> | null): Promise<boolean> => {
      const { error } = await supabase
        .from("drawing_instances" as any)
        .update({ metadata } as any)
        .eq("id", id);
      if (error) {
        toast({
          variant: "destructive",
          title: "Could not save details",
          description: getUserFriendlyError(error),
        });
        return false;
      }
      onInstancesChanged?.();
      return true;
    },
    [toast, onInstancesChanged],
  );

  // When viewing a per-sheet PDF (sheetId provided), the rendered PDF only
  // has a single page (currentPage === 1) but instances are persisted under
  // their original `pageIndex` from the source document. When viewing the
  // full multi-page parent PDF, instances live on whatever page the user is
  // currently on.
  const effectivePage = sheetId ? pageIndex : currentPage;
  // After mutating annotations, drop focus from the just-clicked overlay/list
  // button. Otherwise Radix's DismissableLayer treats the first scrim click as
  // "refocus the previously focused element" and the user has to click a
  // second time before the dialog closes.
  const blurActive = () => {
    if (typeof document === "undefined") return;
    const el = document.activeElement as HTMLElement | null;
    if (el && typeof el.blur === "function") el.blur();
  };

  // Compute a viewport-space anchor point for a marker at normalized doc
  // coords (nx, ny). Uses the rendered surface DOM to survive pan/zoom.
  const anchorForNormalizedPoint = (
    nx: number,
    ny: number,
  ): { x: number; y: number } | null => {
    const surface = document.querySelector(
      "[data-doc-surface]",
    ) as HTMLElement | null;
    if (!surface) return null;
    const r = surface.getBoundingClientRect();
    return { x: r.left + nx * r.width, y: r.top + ny * r.height };
  };

  // ---- User-initiated actions ---------------------------------------------
  const handleCanvasClick = async (nx: number, ny: number) => {
    if (Date.now() < suppressCanvasClickUntilRef.current) return;
    if (!sidebarEnabled) return;
    if (!selectedClass) return;
    const row = await dbInsert({
      awp_class_name: selectedClass,
      nx,
      ny,
      page_index: effectivePage,
    });
    if (!row) return;
    setInstances((prev) => [...prev, row]);
    setPast((p) => [...p, { type: "add", instance: row }]);
    setFuture([]);
    if (activeTab !== "detections") setActiveTab("detections");
    blurActive();
    // For DCW / FS annotations, immediately prompt for pipe diameter so the
    // user can tag the marker without a second click.
    if (isDiameterEnabledClass(row.awp_class_name)) {
      const anchor = anchorForNormalizedPoint(row.nx, row.ny);
      if (anchor) setMetadataDialog({ instanceId: row.id, anchor });
    }
  };

  // Persist the new position of a unit-plan indicator dot after a drag,
  // clamped to remain inside its owning level bbox.
  const dbUpdatePosition = useCallback(
    async (id: string, nx: number, ny: number): Promise<boolean> => {
      const { error } = await supabase
        .from("drawing_instances" as any)
        .update({ nx, ny } as any)
        .eq("id", id);
      if (error) {
        toast({
          variant: "destructive",
          title: "Could not move marker",
          description: getUserFriendlyError(error),
        });
        return false;
      }
      onInstancesChanged?.();
      return true;
    },
    [toast, onInstancesChanged],
  );

  const handleOverlayDrag = useCallback(
    async (overlayId: string, nx: number, ny: number) => {
      // Annotation circles (DCW / FS etc.) - free-position drag, no clamp.
      if (overlayId.startsWith("inst-")) {
        const id = overlayId.slice(5);
        const inst = instances.find((i) => i.id === id);
        if (!inst) return;
        const clampedNx = Math.max(0, Math.min(1, nx));
        const clampedNy = Math.max(0, Math.min(1, ny));
        setInstances((prev) =>
          prev.map((i) =>
            i.id === id ? { ...i, nx: clampedNx, ny: clampedNy } : i,
          ),
        );
        const ok = await dbUpdatePosition(id, clampedNx, clampedNy);
        if (!ok) {
          setInstances((prev) =>
            prev.map((i) =>
              i.id === id ? { ...i, nx: inst.nx, ny: inst.ny } : i,
            ),
          );
        }
        return;
      }
      if (!overlayId.startsWith("um-")) return;
      const id = overlayId.slice(3);
      const inst = instances.find((i) => i.id === id);
      if (!inst) return;
      // Find the level plan whose bbox originally contained the marker so we
      // can clamp the new drag position back inside it. Fall back to any
      // level plan on this page if the original one can't be identified.
      const levelPlans = (floorPlans ?? []).filter((p) => {
        const eff = (effectiveFloorPlanOverrides as any)[p.plan_id];
        const type = eff?.type ?? p.type;
        return type === "level_floor_plan";
      });
      // Pick the SMALLEST level bbox that contains the marker's ORIGINAL
      // position. Smallest wins so overlapping/nested level bboxes (e.g. L8
      // stacked inside L9) don't misattribute the marker. If no level bbox
      // contains it, reject the drag rather than falling back arbitrarily -
      // that fallback was transferring markers to the wrong level.
      const px = inst.nx * 100;
      const py = inst.ny * 100;
      const containingPlan = levelPlans
        .map((p) => ({ p, bb: getEffectiveBbox(p, effectiveFloorPlanOverrides) }))
        .filter(({ bb }) => {
          if (!bb) return false;
          const [bx, by, bw, bh] = bb;
          return px >= bx && px <= bx + bw && py >= by && py <= by + bh;
        })
        .sort((a, b) => a.bb![2] * a.bb![3] - b.bb![2] * b.bb![3])[0]?.p;
      if (!containingPlan) return;
      const bb = getEffectiveBbox(containingPlan, effectiveFloorPlanOverrides);
      if (!bb) return;
      const [bx, by, bw, bh] = bb;
      const clampedNx = Math.max(bx / 100, Math.min((bx + bw) / 100, nx));
      const clampedNy = Math.max(by / 100, Math.min((by + bh) / 100, ny));
      // Optimistic local update.
      setInstances((prev) =>
        prev.map((i) =>
          i.id === id ? { ...i, nx: clampedNx, ny: clampedNy } : i,
        ),
      );
      const ok = await dbUpdatePosition(id, clampedNx, clampedNy);
      if (!ok) {
        // Roll back on failure.
        setInstances((prev) =>
          prev.map((i) =>
            i.id === id ? { ...i, nx: inst.nx, ny: inst.ny } : i,
          ),
        );
      }
    },
    [instances, floorPlans, effectiveFloorPlanOverrides, dbUpdatePosition],
  );

  // Now that dbInsert + effectivePage are in scope, install the actual
  // "Place Unit Floor Plan Marker" implementation into the forward-ref.
  handleStartUnitMarkerPlacementRef.current = async (planId: string) => {
    const prev = editingPlanRef.current;
    if (prev) await savePlanEdit();
    const plan = (floorPlans ?? []).find((p) => p.plan_id === planId);
    const bb = plan
      ? getEffectiveBbox(plan, effectiveFloorPlanOverrides)
      : null;
    if (!bb) return;
    const [bx, by, bw, bh] = bb;
    // Bbox is in percentages (0..100) of the page; markers use normalized 0..1.
    const x0 = bx / 100;
    const y0 = by / 100;
    const x1 = (bx + bw) / 100;
    const y1 = (by + bh) / 100;
    // Shrink the allowed area by a margin so the visible circle stays inside
    // the level bbox even at bbox corners.
    const margin = Math.min(0.012, (x1 - x0) * 0.1, (y1 - y0) * 0.1);
    const ix0 = x0 + margin;
    const iy0 = y0 + margin;
    const ix1 = Math.max(ix0, x1 - margin);
    const iy1 = Math.max(iy0, y1 - margin);
    const cx = (ix0 + ix1) / 2;
    const cy = (iy0 + iy1) / 2;
    const existing = instances.filter(
      (i) =>
        i.awp_class_name === UNIT_MARKER_CLASS &&
        i.file_id === parentFileId &&
        i.page_index === effectivePage,
    );
    const tooClose = (a: number, b: number) => Math.abs(a - b) < 0.006;
    const collides = (nx: number, ny: number) =>
      existing.some((i) => tooClose(i.nx, nx) && tooClose(i.ny, ny));
    // Spiral candidates around the center of the level bbox; always clamped
    // inside the inner rect so the marker cannot escape the level bbox.
    const step = 0.014;
    let nx = cx;
    let ny = cy;
    for (let attempts = 0; attempts < 96; attempts++) {
      // Golden-angle spiral for even coverage.
      const angle = attempts * 2.399963;
      const radius = step * Math.sqrt(attempts);
      const candX = Math.max(ix0, Math.min(ix1, cx + Math.cos(angle) * radius));
      const candY = Math.max(iy0, Math.min(iy1, cy + Math.sin(angle) * radius));
      nx = candX;
      ny = candY;
      if (!collides(nx, ny)) break;
    }
    const row = await dbInsert({
      awp_class_name: UNIT_MARKER_CLASS,
      nx,
      ny,
      page_index: effectivePage,
    });
    if (!row) return;
    setInstances((prev) => [...prev, row]);
    blurActive();
  };



  const handleOverlayClick = async (overlayId: string) => {
    if (!sidebarEnabled) return;
    // Unit-marker dot: click always deletes, regardless of placement mode.
    if (overlayId.startsWith("um-")) {
      const id = overlayId.slice(3);
      const inst = instances.find((i) => i.id === id);
      if (!inst) return;
      const ok = await dbDelete(inst.id);
      if (!ok) return;
      setInstances((prev) => prev.filter((i) => i.id !== inst.id));
      blurActive();
      return;
    }
    const instId = overlayId.startsWith("inst-") ? overlayId.slice(5) : overlayId;
    const inst = instances.find((i) => i.id === instId);
    if (!inst) return;
    // DCW / FS: clicking an existing marker opens the metadata popover so the
    // user can adjust diameter (or delete via the trash button).
    if (isDiameterEnabledClass(inst.awp_class_name)) {
      const anchor = anchorForNormalizedPoint(inst.nx, inst.ny);
      if (anchor) setMetadataDialog({ instanceId: inst.id, anchor });
      return;
    }
    // Other classes: keep legacy click-to-delete behavior.
    const ok = await dbDelete(inst.id);
    if (!ok) return;
    setInstances((prev) => prev.filter((i) => i.id !== inst.id));
    setPast((p) => [...p, { type: "delete", instance: inst }]);
    setFuture([]);
    blurActive();
  };

  const handleDeleteFromList = async (id: string) => {
    const inst = instances.find((i) => i.id === id);
    if (!inst) return;
    const ok = await dbDelete(id);
    if (!ok) return;
    setInstances((prev) => prev.filter((i) => i.id !== id));
    setPast((p) => [...p, { type: "delete", instance: inst }]);
    setFuture([]);
    blurActive();
  };

  // ---- Undo / redo --------------------------------------------------------
  const undo = async () => {
    if (past.length === 0) return;
    const action = past[past.length - 1];
    if (action.type === "add") {
      const ok = await dbDelete(action.instance.id);
      if (!ok) return;
      setInstances((prev) => prev.filter((i) => i.id !== action.instance.id));
      setPast((p) => p.slice(0, -1));
      setFuture((f) => [...f, action]);
    } else {
      // Re-insert deleted marker → DB will assign a new id
      const row = await dbInsert({
        awp_class_name: action.instance.awp_class_name,
        nx: action.instance.nx,
        ny: action.instance.ny,
        page_index: action.instance.page_index,
      });
      if (!row) return;
      setInstances((prev) => [...prev, row]);
      setPast((p) => p.slice(0, -1));
      // Store the new row so a subsequent redo deletes the correct id
      setFuture((f) => [...f, { type: "delete", instance: row }]);
    }
  };

  const redo = async () => {
    if (future.length === 0) return;
    const action = future[future.length - 1];
    if (action.type === "add") {
      // Re-insert the previously undone add
      const row = await dbInsert({
        awp_class_name: action.instance.awp_class_name,
        nx: action.instance.nx,
        ny: action.instance.ny,
        page_index: action.instance.page_index,
      });
      if (!row) return;
      setInstances((prev) => [...prev, row]);
      setFuture((f) => f.slice(0, -1));
      setPast((p) => [...p, { type: "add", instance: row }]);
    } else {
      const ok = await dbDelete(action.instance.id);
      if (!ok) return;
      setInstances((prev) => prev.filter((i) => i.id !== action.instance.id));
      setFuture((f) => f.slice(0, -1));
      setPast((p) => [...p, action]);
    }
  };

  // ---- Source ------------------------------------------------------------
  const source: DocumentSourceDescriptor | null = useMemo(() => {
    if (!isOpen) return null;
    if (sourceOverride) return sourceOverride;
    if (!fileId || !accessToken) return null;
    return {
      kind: "drive",
      fileId,
      accessToken,
      mimeType,
      fileName,
    };
  }, [isOpen, sourceOverride, fileId, accessToken, mimeType, fileName]);

  // ---- Numbering: persistent per AWP class --------------------------------
  // IDs are stored on each row (instance_number). Deleting does NOT renumber
  // - gaps remain and the next added marker continues past the highest ID.
  // Fallback for rows that haven't been backfilled yet: append in created_at
  // order after the highest stored number.
  const prefixByClass = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of awpClasses || []) m.set(c.name, c.prefix || c.name.slice(0, 3).toUpperCase());
    return m;
  }, [awpClasses]);

  const numberByInstanceId = useMemo(() => {
    const m = new Map<string, number>();
    const byClass = new Map<string, DrawingInstanceRow[]>();
    for (const inst of instances) {
      const arr = byClass.get(inst.awp_class_name) || [];
      arr.push(inst);
      byClass.set(inst.awp_class_name, arr);
    }
    for (const [, arr] of byClass) {
      let maxNum = 0;
      for (const inst of arr) {
        if (typeof inst.instance_number === "number") {
          m.set(inst.id, inst.instance_number);
          if (inst.instance_number > maxNum) maxNum = inst.instance_number;
        }
      }
      // Assign sequential numbers to any rows missing instance_number
      const missing = arr
        .filter((i) => typeof i.instance_number !== "number")
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
      for (const inst of missing) {
        maxNum += 1;
        m.set(inst.id, maxNum);
      }
    }
    return m;
  }, [instances]);

  const instanceMeta = (inst: DrawingInstanceRow) => {
    const meta = (inst.metadata && typeof inst.metadata === "object"
      ? (inst.metadata as any)
      : {}) as Record<string, any>;
    const diameter =
      typeof meta.pipe_diameter === "string" ? meta.pipe_diameter.trim() : "";
    const pipeType =
      typeof meta.pipe_type === "string" ? meta.pipe_type.trim() : "";
    return { diameter, pipeType };
  };

  const instanceLabel = (inst: DrawingInstanceRow) => {
    const n = numberByInstanceId.get(inst.id) ?? 0;
    const prefix = prefixByClass.get(inst.awp_class_name) || "AWP";
    const padded = String(n).padStart(3, "0");
    const { diameter, pipeType } = instanceMeta(inst);
    // Type value (CW/HW) is folded into the acronym: CW-Potable-001.
    const base = pipeType ? `${prefix}-${pipeType}-${padded}` : `${prefix}-${padded}`;
    return diameter ? `${base} (${diameter})` : base;
  };

  // ---- Overlays ----------------------------------------------------------
  const detectionOverlays: OverlayInput[] = useMemo(() => {
    if (readOnly) return [];
    return detections.map((d, i) => {
      const coords = d.coordinates;
      const maxCoord = Math.max(...coords);
      const isNormalizedXYWH = maxCoord <= 1;
      return {
        id: `det-${i}-${d.lineCode}`,
        bbox: coords,
        coordSpace: isNormalizedXYWH ? "normalized" : "pdf-points",
        page: 1,
        color: BOUNDING_BOX_COLOR,
        label: d.lineCode || d.systemType,
      };
    });
  }, [detections, readOnly]);

  // User-placed circles, but only for THIS file and current page.
  // Overlay page depends on the source shape:
  //  - singlePageOnly = full PDF rendered at a specific page → use currentPage
  //  - sheetId (and !singlePageOnly) = per-sheet single-page raster → always 1
  //  - otherwise (full multi-page navigation) → instance's page_index
  const instanceOverlays: OverlayInput[] = useMemo(() => {
    const allowed = awpClasses ? new Set(awpClasses.map((c) => c.name)) : null;
    return instances
      .filter(
        (i) =>
          i.file_id === parentFileId &&
          i.page_index === effectivePage &&
          (!allowed || allowed.has(i.awp_class_name)),
      )
      .map((i) => {
        const { pipeType } = instanceMeta(i);
        return {
          id: `inst-${i.id}`,
          // bbox width/height = 0 so the centroid is exactly the click point
          bbox: [i.nx, i.ny, 0, 0] as [number, number, number, number],
          coordSpace: "normalized" as const,
          page: singlePageOnly ? currentPage : sheetId ? 1 : i.page_index,
          color: awpClassColorForType(i.awp_class_name, pipeType),
          label: instanceLabel(i),
        };
      });
  }, [instances, effectivePage, sheetId, singlePageOnly, currentPage, parentFileId, numberByInstanceId, prefixByClass, awpClasses]);

  // Floor-plan bbox overlays. Survey agent returns `xy_width_height_pct` as
  // [left, top, width, height] percentages (0..100) of the visible page.
  // Pass them straight through as normalized (0..1) coordinates; the
  // OverlayLayer multiplies by the rendered page size so the browser's native
  // layout keeps the boxes in sync on any resize or zoom level.
  const floorPlanOverlays: OverlayInput[] = useMemo(() => {
    if (!floorPlans || floorPlans.length === 0) return [];
    const out: OverlayInput[] = [];
    for (const fp of floorPlans) {
      // Hide the underlying rect for the plan currently in edit mode;
      // the editor overlay replaces it visually with a dotted box.
      if (editingPlan?.planId === fp.plan_id) continue;
      const bb = getEffectiveBbox(fp, floorPlanOverrides ?? {});
      if (!bb) continue;
      const [left, top, width, height] = bb;
      const labelBase = getEffectiveLabel(fp, floorPlanOverrides ?? {});
      out.push({
        id: `fp-${fp.plan_id}`,
        bbox: [left / 100, top / 100, width / 100, height / 100],
        coordSpace: "normalized" as const,
        page: currentPage,
        shape: "rect" as const,
        color: (() => {
          const t = ((floorPlanOverrides ?? {})[fp.plan_id] as any)?.type || fp.type || "unknown";
          return awpClassColor(
            t === "unit_floor_plan"
              ? "Unit Floor Plan"
              : t === "level_floor_plan"
                ? "Level Floor Plan"
                : t,
          );
        })(),
        label: labelBase,
      });
    }
    return out;
  }, [floorPlans, floorPlanOverrides, currentPage, editingPlan]);


  // Unit-plan indicator dots inside a level bbox. Not tied to any specific
  // unit reference. Filled dot, no border, no label. Click to delete.
  const unitMarkerOverlays: OverlayInput[] = useMemo(() => {
    const uc = awpClassColor("Unit Floor Plan");
    return instances
      .filter(
        (i) =>
          i.awp_class_name === UNIT_MARKER_CLASS &&
          i.file_id === parentFileId &&
          i.page_index === effectivePage,
      )
      .map((i) => ({
        id: `um-${i.id}`,
        bbox: [i.nx, i.ny, 0, 0] as [number, number, number, number],
        coordSpace: "normalized" as const,
        page: singlePageOnly ? currentPage : sheetId ? 1 : i.page_index,
        color: uc,
        variant: "dot" as const,
      }));
  }, [instances, effectivePage, sheetId, singlePageOnly, currentPage, parentFileId]);

  const overlays = [
    ...detectionOverlays,
    ...instanceOverlays,
    ...floorPlanOverlays,
    ...unitMarkerOverlays,
  ];

  // For the sidebar: instances for THIS file, on the current page, grouped by class.
  const instancesByClassThisFile = useMemo(() => {
    const allowed = awpClasses
      ? new Set(awpClasses.map((c) => c.name))
      : null;
    const m = new Map<string, DrawingInstanceRow[]>();
    for (const i of instances) {
      if (i.file_id !== parentFileId) continue;
      if (i.page_index !== effectivePage) continue;
      if (allowed && !allowed.has(i.awp_class_name)) continue;
      const arr = m.get(i.awp_class_name) || [];
      arr.push(i);
      m.set(i.awp_class_name, arr);
    }
    return m;
  }, [instances, parentFileId, effectivePage, awpClasses]);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          guardThen("close", () => {
            if (rotationTimerRef.current) {
              window.clearTimeout(rotationTimerRef.current);
              rotationTimerRef.current = null;
            }
            void flushRotations();
            onClose();
          });
        }
      }}

    >
      <DialogContent className="max-w-[95vw] w-[95vw] h-[90vh] flex flex-col p-4 [&>button]:top-4 [&>button]:right-4">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="truncate flex items-center gap-2 min-w-0">
            <span className="truncate">{fileName}</span>
            {titleAccessory}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-1 gap-4 overflow-hidden min-h-0">
          <div
            ref={viewerContainerRef}
            className="flex-1 border rounded-lg overflow-hidden bg-muted/30 min-h-0 relative"
          >
            <DrawingViewer
              source={source}
              layout="single-page"
              page={currentPage}
              rotation={rotationByPage[currentPage] ?? 0}
              onRotate={handleRotate}
              onDownload={() => setDownloadDialogOpen(true)}

              onPageChange={singlePageOnly ? () => {} : setCurrentPage}
              hidePageNav={singlePageOnly}
              overlays={overlays}
              hoveredOverlayId={
                hoveredCode
                  ? detectionOverlays.find((o) =>
                      o.id.endsWith(`-${hoveredCode}`),
                    )?.id ?? null
                  : null
              }
              initialFit="page"
              minScale={0.8}
              maxScale={8}
              onCanvasClick={sidebarEnabled ? handleCanvasClick : undefined}
              onOverlayClick={sidebarEnabled ? handleOverlayClick : undefined}
              onOverlayDrag={sidebarEnabled ? handleOverlayDrag : undefined}
              onActivePageRenderedSizeChange={setRenderedPageSize}
              onApiReady={(api) => (viewerApiRef.current = api)}
              editorBbox={
                editingPlan
                  ? {
                      nx: editingPlan.bbox[0] / 100,
                      ny: editingPlan.bbox[1] / 100,
                      nw: editingPlan.bbox[2] / 100,
                      nh: editingPlan.bbox[3] / 100,
                    }
                  : null
              }
              onEditorBboxChange={(next) =>
                setEditingPlan((prev) =>
                  prev
                    ? {
                        ...prev,
                        bbox: [
                          next.nx * 100,
                          next.ny * 100,
                          next.nw * 100,
                          next.nh * 100,
                        ],
                      }
                    : prev,
                )
              }
              editorColor={
                editingPlan
                  ? awpClassColor(
                      editingPlan.type === "unit_floor_plan"
                        ? "Unit Floor Plan"
                        : "Level Floor Plan",
                    )
                  : undefined
              }
              onPlacingChange={setIsPlacingLabels}
            />
          </div>


          {sidebarEnabled && awpClasses ? (
            <div className="w-80 flex-shrink-0 border rounded-lg flex flex-col min-h-0 relative">
              {isPlacingLabels && (
                <div
                  className="absolute inset-0 z-20 flex items-center justify-center bg-background/60 backdrop-blur-[1px] rounded-lg"
                  aria-live="polite"
                  aria-busy="true"
                >
                  <div className="flex items-center gap-2 text-xs text-muted-foreground bg-background/90 border rounded-md px-3 py-1.5 shadow-sm">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Placing labels…
                  </div>
                </div>
              )}
              <div
                className={
                  isPlacingLabels
                    ? "flex-1 flex flex-col min-h-0 pointer-events-none select-none"
                    : "flex-1 flex flex-col min-h-0"
                }
              >
              <Tabs
                value={activeTab}
                onValueChange={(v) => {
                  const target = v as "floor-plans" | "detections";
                  if (target === activeTab) return;
                  guardThen("tab", () => setActiveTab(target));
                }}
                className="flex-1 flex flex-col min-h-0"
              >
                <TabsList className="m-2 grid grid-cols-2">
                  <TabsTrigger value="floor-plans">Floor Plans</TabsTrigger>
                  <TabsTrigger value="detections">Detections</TabsTrigger>
                </TabsList>
                <TabsContent
                  value="floor-plans"
                  forceMount
                  className="flex-1 min-h-0 m-0 mt-0 overflow-hidden flex flex-col data-[state=inactive]:hidden"
                >
                  <FloorPlansPanel
                    floorPlans={floorPlans ?? []}
                    allUnitPlans={allUnitPlans ?? []}
                    allLevelPlans={allLevelPlans ?? []}
                    allLevelPlanOverrides={allLevelPlanOverrides}
                    overrides={effectiveFloorPlanOverrides}

                    onSaveOverride={onSaveFloorPlanOverride}
                    onEditFloors={onEditFloors}
                    onEditLevelUnits={onEditLevelUnits}
                    onSaveLevelUnits={onSaveLevelUnits}
                    onPlaceUnitBbox={sidebarEnabled ? handleStartUnitMarkerPlacement : undefined}
                    instancesOnPage={Array.from(instancesByClassThisFile.values()).flat()}
                    numberByInstanceId={numberByInstanceId}
                    instanceLabel={instanceLabel}
                    editingPlan={editingPlan}
                    onEnterEdit={enterPlanEdit}
                    onCancelEdit={cancelPlanEdit}
                    onSaveEdit={savePlanEdit}
                    onEditingNameChange={(name) =>
                      setEditingPlan((p) => (p ? { ...p, name } : p))
                    }
                    onEditingTypeChange={(t) => {
                      if (t === "level_floor_plan" || t === "unit_floor_plan") {
                        lastPlanTypeRef.current = t;
                      }
                      setEditingPlan((p) => (p ? { ...p, type: t } : p));
                    }}
                    onRequestDelete={(planId, label) =>
                      setConfirmDelete({ planId, label })
                    }
                    onAddPlan={onAddPlan ? handleAddPlan : undefined}
                    focusNamePlanId={focusNamePlanId}
                    onFocusHandled={() => setFocusNamePlanId(null)}
                  />
                </TabsContent>
                <TabsContent value="detections" className="flex-1 overflow-hidden m-0 mt-0 flex flex-col min-h-0 data-[state=inactive]:hidden">
                  <DetectionsPanel
                    awpClasses={awpClasses}
                    selectedClass={selectedClass}
                    setSelectedClass={setSelectedClass}
                    expanded={expanded}
                    setExpanded={setExpanded}
                    instancesByClassThisFile={instancesByClassThisFile}
                    numberByInstanceId={numberByInstanceId}
                    effectivePage={effectivePage}
                    instanceLabel={instanceLabel}
                    handleDeleteFromList={handleDeleteFromList}
                    loadingInstances={loadingInstances}
                    undo={undo}
                    redo={redo}
                    pastLen={past.length}
                    futureLen={future.length}
                    floorPlans={floorPlans}
                    floorPlanOverrides={effectiveFloorPlanOverrides}
                  />
                </TabsContent>
              </Tabs>
              </div>
            </div>



          ) : detections.length > 0 ? (
            <div className="w-64 flex-shrink-0 border rounded-lg p-3 flex flex-col relative">
              {isPlacingLabels && (
                <div
                  className="absolute inset-0 z-20 flex items-center justify-center bg-background/60 backdrop-blur-[1px] rounded-lg"
                  aria-live="polite"
                  aria-busy="true"
                >
                  <div className="flex items-center gap-2 text-xs text-muted-foreground bg-background/90 border rounded-md px-3 py-1.5 shadow-sm">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Placing labels…
                  </div>
                </div>
              )}
              <div
                className={
                  isPlacingLabels
                    ? "flex-1 flex flex-col min-h-0 pointer-events-none select-none"
                    : "flex-1 flex flex-col min-h-0"
                }
              >
                <h4 className="text-sm font-medium mb-2">
                  Detected Systems ({detections.length})
                </h4>
                <ScrollArea className="flex-1">
                  <div className="space-y-2 pr-2">
                    {detections.map((detection, i) => (
                      <div
                        key={i}
                        className="p-2 rounded-md border cursor-pointer transition-colors hover:bg-muted/50"
                        style={{
                          borderLeftWidth: 4,
                          borderLeftColor: BOUNDING_BOX_COLOR,
                          backgroundColor:
                            hoveredCode === detection.lineCode
                              ? "hsl(var(--muted))"
                              : undefined,
                        }}
                        onMouseEnter={() => setHoveredCode(detection.lineCode)}
                        onMouseLeave={() => setHoveredCode(null)}
                      >
                        <p className="text-xs font-medium truncate">
                          {detection.lineCode}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {detection.systemType}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {detection.lineMonitored}
                        </p>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            </div>
          ) : null}
        </div>

        {/* Unsaved-changes prompt when leaving edit mode */}
        <AlertDialog
          open={!!confirmExit}
          onOpenChange={(o) => {
            if (!o) setConfirmExit(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Unsaved bounding box edits</AlertDialogTitle>
              <AlertDialogDescription>
                You've made changes to a floor plan's bounding box. Save them
                before leaving?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setConfirmExit(null)}>
                Cancel
              </AlertDialogCancel>
              <Button
                variant="outline"
                onClick={() => {
                  const next = confirmExit?.next;
                  setConfirmExit(null);
                  setEditingPlan(null);
                  next?.();
                }}
              >
                Discard Changes
              </Button>
              <AlertDialogAction
                onClick={async () => {
                  const next = confirmExit?.next;
                  setConfirmExit(null);
                  await savePlanEdit();
                  next?.();
                }}
              >
                Save Edits
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Delete plan confirmation */}
        <AlertDialog
          open={!!confirmDelete}
          onOpenChange={(o) => {
            if (!o) setConfirmDelete(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete floor plan?</AlertDialogTitle>
              <AlertDialogDescription>
                This removes "{confirmDelete?.label}" from this page. Annotations
                inside its area will become orphaned. This can't be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={async () => {
                  const planId = confirmDelete?.planId;
                  setConfirmDelete(null);
                  if (planId) {
                    if (editingPlan?.planId === planId) setEditingPlan(null);
                    await onDeletePlan?.(planId);
                  }
                }}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {(() => {
          if (!metadataDialog) return null;
          const inst = instances.find((i) => i.id === metadataDialog.instanceId);
          if (!inst) return null;
          const defs = metaFieldsForClass(inst.awp_class_name);
          if (defs.length === 0) return null;
          const meta =
            inst.metadata && typeof inst.metadata === "object"
              ? (inst.metadata as Record<string, any>)
              : {};
          const sameClass = instances.filter(
            (i) => i.awp_class_name === inst.awp_class_name,
          );
          const fields = defs.map((d) => {
            const cur =
              typeof meta[d.key] === "string" ? (meta[d.key] as string).trim() : "";
            const suggestions = Array.from(
              new Set(
                sameClass
                  .map((i) => {
                    const m = (i.metadata as any) || {};
                    return typeof m[d.key] === "string"
                      ? (m[d.key] as string).trim()
                      : "";
                  })
                  .filter(Boolean),
              ),
            );
            return {
              key: d.key,
              label: d.label,
              placeholder: d.placeholder,
              currentValue: cur || null,
              suggestions,
            };
          });
          const n = numberByInstanceId.get(inst.id) ?? 0;
          const prefix = prefixByClass.get(inst.awp_class_name) || "AWP";
          const marker = `${prefix}-${String(n).padStart(3, "0")}`;
          const titleSuffix = defs.length > 1 ? "attributes" : defs[0].label.toLowerCase();
          return (
            <AnnotationMetadataPopover
              open
              anchor={metadataDialog.anchor}
              title={`${marker} · ${titleSuffix}`}
              fields={fields}
              onClose={closeMetadataDialog}
              onCommit={async (key, next) => {
                const buildMeta = (base: Record<string, any> | null) => {
                  const rest = { ...(base || {}) };
                  if (next) {
                    rest[key] = next;
                  } else {
                    delete rest[key];
                  }
                  return Object.keys(rest).length ? rest : null;
                };
                const nextMeta = buildMeta(inst.metadata);
                const ok = await dbUpdateMetadata(inst.id, nextMeta);
                if (!ok) return;
                setInstances((prev) =>
                  prev.map((i) =>
                    i.id === inst.id ? { ...i, metadata: nextMeta } : i,
                  ),
                );
              }}
              onDelete={async () => {
                const ok = await dbDelete(inst.id);
                if (!ok) return;
                setInstances((prev) => prev.filter((i) => i.id !== inst.id));
                setPast((p) => [...p, { type: "delete", instance: inst }]);
                setFuture([]);
              }}
            />
          );
        })()}
      </DialogContent>

      <PageDownloadDialog
        open={downloadDialogOpen}
        onOpenChange={setDownloadDialogOpen}
        busy={downloadBusy}
        setBusy={setDownloadBusy}
        includeOverlays={downloadIncludeOverlays}
        setIncludeOverlays={setDownloadIncludeOverlays}
        source={source}
        downloadSource={downloadSourceOverride ?? source}
        page={downloadPageOverride ?? currentPage}
        overlays={overlays}
        fileName={fileName}
        userRotation={rotationByPage[currentPage] ?? 0}
      />
    </Dialog>
  );
};


// ============================================================================
// Sub-components
// ============================================================================

interface DetectionsPanelProps {
  awpClasses: AwpClassOption[];
  selectedClass: string | null;
  setSelectedClass: (n: string | null) => void;
  expanded: Set<string>;
  setExpanded: (updater: (prev: Set<string>) => Set<string>) => void;
  instancesByClassThisFile: Map<string, DrawingInstanceRow[]>;
  numberByInstanceId: Map<string, number>;
  effectivePage: number;
  instanceLabel: (i: DrawingInstanceRow) => string;
  handleDeleteFromList: (id: string) => void;
  loadingInstances: boolean;
  undo: () => void;
  redo: () => void;
  pastLen: number;
  futureLen: number;
  withHeader?: boolean;
  floorPlans?: ParsedFloorPlan[];
  floorPlanOverrides?: Record<string, any>;
}

// Find the floor plan whose bbox contains the normalized (0..1) point.
// Prefers smaller (more specific) bboxes when multiple contain the point.
const findContainingPlan = (
  plans: ParsedFloorPlan[],
  nx: number,
  ny: number,
  overrides: Record<string, any> = {},
): ParsedFloorPlan | null => {
  const x = nx * 100;
  const y = ny * 100;
  let best: ParsedFloorPlan | null = null;
  let bestArea = Infinity;
  for (const fp of plans) {
    const bb = getEffectiveBbox(fp, overrides);
    if (!bb) continue;
    const [bx, by, bw, bh] = bb;
    if (x < bx || x > bx + bw || y < by || y > by + bh) continue;
    const area = bw * bh;
    if (area < bestArea) {
      best = fp;
      bestArea = area;
    }
  }
  return best;
};

const DetectionsPanel = ({
  awpClasses,
  selectedClass,
  setSelectedClass,
  expanded,
  setExpanded,
  instancesByClassThisFile,
  numberByInstanceId,
  effectivePage,
  instanceLabel,
  handleDeleteFromList,
  loadingInstances,
  undo,
  redo,
  pastLen,
  futureLen,
  withHeader,
  floorPlans,
  floorPlanOverrides = {},
}: DetectionsPanelProps) => {
  const showPlanBadges = (floorPlans?.length ?? 0) > 0;
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className={`px-3 py-2 ${withHeader ? "border-b" : ""} flex items-start justify-between gap-2`}>
        <div>
          <h4 className="text-sm font-medium">AWP classes</h4>
          <p className="text-[11px] text-muted-foreground">
            Click the canvas to mark; click a marker to remove.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={undo} disabled={pastLen === 0} aria-label="Undo" title="Undo">
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={redo} disabled={futureLen === 0} aria-label="Redo" title="Redo">
            <Redo2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-hidden min-w-0">
        <div className="py-1 w-full min-w-0">
          {loadingInstances && (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading markers…
            </div>
          )}
          {awpClasses.map((c) => {
            const subList = instancesByClassThisFile.get(c.name) || [];
            const userCount = subList.length;
            const total = c.analysisCount + userCount;
            const isSelected = selectedClass === c.name;
            const isExpanded = expanded.has(c.name);
            const color = awpClassColor(c.name);
            return (
              <div key={c.name} className="border-b last:border-b-0 min-w-0">
                <div
                  className={`flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-muted/50 min-w-0 ${isSelected ? "bg-muted/40" : ""}`}
                  onClick={() => setSelectedClass(c.name)}
                >
                  <input
                    type="radio"
                    checked={isSelected}
                    onChange={() => setSelectedClass(c.name)}
                    onClick={(e) => { e.stopPropagation(); setSelectedClass(c.name); }}
                    className="h-3.5 w-3.5 shrink-0"
                  />
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                  <span className="font-mono text-xs text-muted-foreground shrink-0">{c.prefix ?? "-"}</span>
                  <span className="flex-1 min-w-0 truncate" title={c.name}>{c.name}</span>
                  <span className="text-xs tabular-nums text-muted-foreground shrink-0">{total}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpanded((prev) => {
                        const next = new Set(prev);
                        if (next.has(c.name)) next.delete(c.name);
                        else next.add(c.name);
                        return next;
                      });
                    }}
                    className="shrink-0 text-muted-foreground hover:text-foreground p-0.5 rounded hover:bg-muted/50"
                    aria-label={isExpanded ? "Collapse" : "Expand"}
                  >
                    {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                </div>
                {isExpanded && (
                  <div className="px-8 py-1 space-y-1 bg-muted/20">
                    {c.analysisCount > 0 && (
                      <div className="text-[11px] text-muted-foreground">{c.analysisCount} from analysis</div>
                    )}
                    {subList.length === 0 && c.analysisCount === 0 && (
                      <div className="text-[11px] text-muted-foreground italic">No instances yet.</div>
                    )}
                    {subList
                      .slice()
                      .sort((a, b) => (numberByInstanceId.get(a.id) ?? 0) - (numberByInstanceId.get(b.id) ?? 0))
                      .map((i) => {
                        const containingPlan =
                          showPlanBadges && floorPlans
                            ? findContainingPlan(floorPlans, i.nx, i.ny, floorPlanOverrides)
                            : null;
                        const planLabel = containingPlan
                          ? getEffectiveLabel(containingPlan, floorPlanOverrides)
                          : null;
                        const iMeta = (i.metadata && typeof i.metadata === "object" ? (i.metadata as any) : {}) as Record<string, any>;
                        const iPipeType = typeof iMeta.pipe_type === "string" ? iMeta.pipe_type.trim() : "";
                        const dotColor = awpClassColorForType(c.name, iPipeType);
                        return (
                          <div key={i.id} className="flex items-center gap-2 text-[11px]">
                            <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: dotColor }} />
                            <span className="flex-1 min-w-0 font-mono truncate">
                              {instanceLabel(i)}
                              {i.page_index !== effectivePage ? ` (p.${i.page_index})` : ""}
                            </span>
                            {planLabel && (() => {
                              const effT = getEffectiveType(containingPlan!, floorPlanOverrides);
                              const ct = effT === "unit_floor_plan"
                                ? "Unit Floor Plan"
                                : effT === "level_floor_plan"
                                  ? "Level Floor Plan"
                                  : effT || "unknown";
                              const cc = awpClassColor(ct);
                              return (
                                <span
                                  className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-medium max-w-[80px] truncate border"
                                  style={{
                                    backgroundColor: softBgFrom(cc),
                                    color: cc,
                                    borderColor: cc,
                                  }}
                                  title={`In ${planLabel}`}
                                >
                                  {planLabel}
                                </span>
                              );
                            })()}
                            <button
                              onClick={() => handleDeleteFromList(i.id)}
                              className="shrink-0 text-muted-foreground hover:text-destructive px-1"
                              aria-label="Remove marker"
                            >
                              ×
                            </button>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

interface EditingPlanShape {
  planId: string;
  bbox: [number, number, number, number];
  name: string;
  type: string;
  origBbox: [number, number, number, number];
  origName: string;
  origType: string;
}

interface FloorPlansPanelProps {
  floorPlans: ParsedFloorPlan[];
  allUnitPlans: ParsedFloorPlan[];
  allLevelPlans: ParsedFloorPlan[];
  overrides: Record<string, any>;
  /** File-wide overrides keyed by plan_id, used to look up level-plan unit
   *  assignments saved on other pages (needed for "Referenced in"). */
  allLevelPlanOverrides?: Record<string, { units?: string[] }>;

  onSaveOverride?: (
    planId: string,
    next: {
      floors?: string[];
      units?: string[];
      annotations?: string[];
      bbox_pct?: [number, number, number, number] | null;
      name?: string | null;
      type?: string | null;
    },
  ) => Promise<void> | void;
  onEditFloors?: (planId: string, currentFloors: string[]) => void;
  onEditLevelUnits?: (plan: ParsedFloorPlan, currentUnits: string[]) => void;
  onSaveLevelUnits?: (
    plan: ParsedFloorPlan,
    units: string[],
    createdRefs?: string[],
    removedRefs?: string[],
  ) => Promise<void> | void;
  /** Optional: place a new unit-floor-plan bbox on the current page linked
   *  to an existing unit reference (e.g. "Detail 6"). */
  onPlaceUnitBbox?: (refId: string) => Promise<void> | void;
  /** Real markers placed on this page (one row per instance). */
  instancesOnPage?: DrawingInstanceRow[];
  numberByInstanceId?: Map<string, number>;
  instanceLabel?: (i: DrawingInstanceRow) => string;
  /** Bbox-edit integration. */
  editingPlan?: EditingPlanShape | null;
  onEnterEdit?: (fp: ParsedFloorPlan) => void;
  onCancelEdit?: () => void;
  onSaveEdit?: () => void | Promise<void>;
  onEditingNameChange?: (name: string) => void;
  onEditingTypeChange?: (type: string) => void;
  onRequestDelete?: (planId: string, label: string) => void;
  onAddPlan?: () => void | Promise<void>;
  /** When set, that row's name <Input> should autoFocus + select() on mount
   *  and the row should scroll into view. Parent clears via onFocusHandled. */
  focusNamePlanId?: string | null;
  onFocusHandled?: () => void;
}

const FloorPlansPanel = ({
  floorPlans,
  allUnitPlans,
  allLevelPlans,
  overrides,
  allLevelPlanOverrides,
  onSaveLevelUnits,
  onPlaceUnitBbox,
  instancesOnPage = [],
  numberByInstanceId,
  instanceLabel,
  editingPlan,
  onEnterEdit,
  onCancelEdit,
  onSaveEdit,
  onEditingNameChange,
  onEditingTypeChange,
  onRequestDelete,
  onAddPlan,
  focusNamePlanId,
  onFocusHandled,
}: FloorPlansPanelProps) => {

  // For a unit floor plan, list the pages of level plans that reference it.
  // Level plans reference units by human-readable identifier. Match against
  // the unit's effective name (user override wins over reference_id), its
  // reference_id, AND its plan_id — all case-insensitively / trimmed — so a
  // level plan whose `referenced_unit_ids` was captured as "detail 22" still
  // matches a unit whose reference_id is "Detail 22".
  const findReferencingLevels = (unit: ParsedFloorPlan): string[] => {
    const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
    const unitOvr = overrides[unit.plan_id];
    const unitKeys = new Set<string>();
    const overrideName = typeof unitOvr?.name === "string" ? unitOvr.name : null;
    if (overrideName) unitKeys.add(norm(overrideName));
    unitKeys.add(norm(unitPlanRefKey(unit)));
    unitKeys.add(norm(unit.reference_id));
    unitKeys.add(norm(unit.plan_id));
    unitKeys.delete("");

    const counts = new Map<string, { name: string; page: number; count: number }>();
    for (const lvl of allLevelPlans) {
      const localOvr = overrides[lvl.plan_id];
      const fileOvr = allLevelPlanOverrides?.[lvl.plan_id];
      const effUnits: string[] =
        localOvr?.units ?? fileOvr?.units ?? lvl.referenced_unit_ids ?? [];
      const matchCount = effUnits.reduce(
        (n, u) => n + (unitKeys.has(norm(u)) ? 1 : 0),
        0,
      );
      if (matchCount <= 0) continue;
      const nameOvr = typeof localOvr?.name === "string" ? localOvr.name : null;
      const name = (nameOvr ?? lvl.reference_id ?? lvl.plan_id ?? "").trim() || "Level";
      const key = `${name}::${lvl.page_number}`;
      const existing = counts.get(key);
      if (existing) existing.count += matchCount;
      else counts.set(key, { name, page: lvl.page_number, count: matchCount });
    }
    return Array.from(counts.values())
      .sort((a, b) => a.page - b.page || a.name.localeCompare(b.name))
      .map((m) => `${m.name} (p${m.page})${m.count > 1 ? ` x${m.count}` : ""}`);
  };


  // Compute per-plan annotation membership purely by bbox containment of the
  // marker's center point. There are no manual assignments - the report
  // generator does the same calculation at output time.
  const annotationsByPlan = new Map<string, DrawingInstanceRow[]>();
  const orphaned: DrawingInstanceRow[] = [];
  for (const inst of instancesOnPage) {
    const containing = findContainingPlan(floorPlans, inst.nx, inst.ny, overrides);
    if (containing) {
      const arr = annotationsByPlan.get(containing.plan_id) ?? [];
      arr.push(inst);
      annotationsByPlan.set(containing.plan_id, arr);
    } else {
      orphaned.push(inst);
    }
  }
  const sortInstances = (rows: DrawingInstanceRow[]) =>
    rows.slice().sort((a, b) => {
      if (a.awp_class_name !== b.awp_class_name) {
        return a.awp_class_name.localeCompare(b.awp_class_name);
      }
      const na = numberByInstanceId?.get(a.id) ?? a.instance_number ?? 0;
      const nb = numberByInstanceId?.get(b.id) ?? b.instance_number ?? 0;
      return na - nb;
    });

  const renderAnnotations = (rows: DrawingInstanceRow[]) => {
    if (rows.length === 0) return null;
    return (
      <div className="flex flex-wrap gap-1">
        {sortInstances(rows).map((inst) => {
          const c = awpClassColor(inst.awp_class_name);
          const label = instanceLabel
            ? instanceLabel(inst)
            : `${inst.awp_class_name}-${inst.instance_number ?? "?"}`;
          return (
            <div
              key={inst.id}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border"
              style={{
                backgroundColor: softBgFrom(c),
                color: c,
                borderColor: c,
              }}
              title={label}
            >
              {label}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2">
        {/* Orphaned bucket - markers whose center falls outside every plan bbox. */}
        {orphaned.length > 0 && (
          <div className="border border-dashed rounded-md p-2 space-y-1 bg-muted/20">
            <div className="text-[11px] font-medium text-muted-foreground">
              Annotations placed outside floor plan ({orphaned.length})
            </div>
            {renderAnnotations(orphaned)}
          </div>
        )}

        {floorPlans.map((fp) => {
          const ovr = overrides[fp.plan_id] ?? {};
          const effFloors = ovr.floors ?? fp.floors;
          const effUnits: string[] = ovr.units ?? fp.referenced_unit_ids;
          const effType: string =
            (typeof ovr.type === "string" && ovr.type) ? ovr.type : fp.type;
          const color = awpClassColor(
            effType === "unit_floor_plan"
              ? "Unit Floor Plan"
              : effType === "level_floor_plan"
                ? "Level Floor Plan"
                : effType || "unknown",
          );
          const fallbackLabel = getEffectiveLabel(fp, overrides) ||
            floorPlanDisplayLabel({ ...fp, floors: effFloors });
          const isUnit = effType === "unit_floor_plan";
          const isLevel = effType === "level_floor_plan";
          const referencedIn = isUnit ? findReferencingLevels(fp) : [];
          const planAnns = annotationsByPlan.get(fp.plan_id) ?? [];
          const isEditingThis = editingPlan?.planId === fp.plan_id;
          const displayLabel = isEditingThis ? editingPlan!.name : fallbackLabel;
          const displayType = isEditingThis ? editingPlan!.type : effType;

          const shouldFocusName =
            !!focusNamePlanId && focusNamePlanId === fp.plan_id;
          return (
            <div
              key={fp.plan_id}
              ref={(el) => {
                if (!el || !shouldFocusName) return;
                // Bring the new row into view once it mounts.
                try {
                  el.scrollIntoView({ block: "nearest", behavior: "smooth" });
                } catch {
                  el.scrollIntoView();
                }
              }}
              className={`border rounded-md p-2 space-y-2 bg-card ${
                isEditingThis ? "ring-2 ring-primary/40" : ""
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="h-2.5 w-2.5 rounded-sm shrink-0"
                  style={{ backgroundColor: color, border: `1px solid ${color}` }}
                />
                {isEditingThis ? (
                  <Input
                    value={editingPlan!.name}
                    onChange={(e) => onEditingNameChange?.(e.target.value)}
                    className="h-7 text-sm flex-1 min-w-0"
                    placeholder="Plan name"
                    autoFocus={shouldFocusName}
                    ref={(el) => {
                      if (!el || !shouldFocusName) return;
                      // Give focus and highlight the placeholder name so the
                      // user can immediately type over it.
                      const t = window.setTimeout(() => {
                        try {
                          el.focus();
                          el.select();
                        } catch {
                          /* noop */
                        }
                        onFocusHandled?.();
                      }, 0);
                      return () => window.clearTimeout(t);
                    }}
                  />
                ) : (
                  <Tooltip delayDuration={200}>
                    <TooltipTrigger asChild>
                      <span className="font-medium text-sm truncate flex-1 cursor-default">
                        {displayLabel}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" align="start" className="max-w-[320px] break-words">
                      {displayLabel}
                    </TooltipContent>
                  </Tooltip>
                )}
                {isEditingThis ? (
                  <select
                    value={displayType}
                    onChange={(e) => onEditingTypeChange?.(e.target.value)}
                    className="text-[10px] h-7 border rounded px-1 bg-background shrink-0"
                  >
                    <option value="level_floor_plan">Level floor plan</option>
                    <option value="unit_floor_plan">Unit floor plan</option>
                  </select>
                ) : (
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0">
                    {(displayType || "").replace(/_/g, " ")}
                  </span>
                )}
                {!isEditingThis && onRequestDelete && (
                  <button
                    type="button"
                    onClick={() => onRequestDelete(fp.plan_id, fallbackLabel)}
                    className="shrink-0 text-muted-foreground hover:text-destructive p-0.5 rounded hover:bg-muted/50"
                    title="Delete floor plan"
                    aria-label="Delete floor plan"
                  >
                    <XIcon className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {onEnterEdit && (
                <div className="flex items-center gap-1">
                  {isEditingThis ? (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        className="h-6 px-2 text-[11px]"
                        onClick={() => void onSaveEdit?.()}
                      >
                        Done
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-[11px]"
                        onClick={() => onCancelEdit?.()}
                      >
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-[11px]"
                      onClick={() => void onEnterEdit(fp)}
                    >
                      Edit Bounding Box
                    </Button>
                  )}
                </div>
              )}

              {isLevel && (
                <LevelUnitsSection
                  fp={fp}
                  effUnits={effUnits}
                  allUnitPlans={allUnitPlans}
                  onSaveLevelUnits={onSaveLevelUnits}
                  onPlaceUnitBbox={onPlaceUnitBbox}
                />
              )}

              {isUnit && (
                <div className="flex items-start gap-1 text-[11px] text-muted-foreground">
                  <span className="font-medium shrink-0">Referenced in:</span>
                  {referencedIn.length === 0 ? (
                    <span className="italic">none</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {referencedIn.map((r) => (
                        <span
                          key={r}
                          className="px-1.5 py-0.5 rounded bg-muted text-foreground text-[10px] font-mono"
                        >
                          {r}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-1">
                <div className="text-[10px] font-medium text-muted-foreground">
                  Annotations ({planAnns.length})
                </div>
                {renderAnnotations(planAnns)}
              </div>
            </div>
          );
        })}
        {floorPlans.length === 0 && instancesOnPage.length === 0 && (
          <div className="text-xs text-muted-foreground italic p-2">
            No floor plan info available.
          </div>
        )}
      </div>

      {onAddPlan && (
        <div className="border-t p-2 shrink-0 bg-background">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="w-full h-8 text-xs gap-1"
            onClick={() => void onAddPlan()}
          >
            <Plus className="h-3.5 w-3.5" />
            Add Floor Plan Bounding Box
          </Button>
        </div>
      )}
    </div>
  );
};

interface LevelUnitsSectionProps {
  fp: ParsedFloorPlan;
  effUnits: string[];
  allUnitPlans: ParsedFloorPlan[];
  onSaveLevelUnits?: (
    plan: ParsedFloorPlan,
    units: string[],
    createdRefs?: string[],
    removedRefs?: string[],
  ) => Promise<void> | void;
  onPlaceUnitBbox?: (refId: string) => Promise<void> | void;
}

const LevelUnitsSection = ({
  fp,
  effUnits,
  allUnitPlans,
  onSaveLevelUnits,
  onPlaceUnitBbox,
}: LevelUnitsSectionProps) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const uc = awpClassColor("Unit Floor Plan");

  // Counts per unique ref in current units.
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const u of effUnits) m.set(u, (m.get(u) || 0) + 1);
    return m;
  }, [effUnits]);

  // All known refs (existing on page + currently selected, even if not parsed).
  const allRefs = useMemo(() => {
    const s = new Set<string>();
    for (const p of allUnitPlans) {
      const k = unitPlanRefKey(p);
      if (k) s.add(k);
    }
    for (const u of effUnits) s.add(u);
    return Array.from(s).sort();
  }, [allUnitPlans, effUnits]);

  const knownSet = useMemo(
    () => new Set(allUnitPlans.map((p) => unitPlanRefKey(p)).filter(Boolean)),
    [allUnitPlans],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allRefs;
    return allRefs.filter((r) => r.toLowerCase().includes(q));
  }, [allRefs, query]);

  const q = query.trim();
  const showCreate =
    q.length > 0 && !allRefs.some((r) => r.toLowerCase() === q.toLowerCase());

  const increment = async (ref: string) => {
    if (!onSaveLevelUnits) return;
    const isNew = !knownSet.has(ref) && !effUnits.includes(ref);
    await onSaveLevelUnits(fp, [...effUnits, ref], isNew ? [ref] : []);
  };

  const decrement = async (ref: string) => {
    if (!onSaveLevelUnits) return;
    // Remove the last occurrence of ref.
    const next = effUnits.slice();
    for (let i = next.length - 1; i >= 0; i--) {
      if (next[i] === ref) {
        next.splice(i, 1);
        break;
      }
    }
    const willBeAbsent = !next.includes(ref);
    await onSaveLevelUnits(fp, next, [], willBeAbsent ? [ref] : []);
  };

  const removeOneAt = async (index: number) => {
    if (!onSaveLevelUnits) return;
    const next = effUnits.slice();
    const [removed] = next.splice(index, 1);
    const willBeAbsent = !next.includes(removed);
    await onSaveLevelUnits(fp, next, [], willBeAbsent ? [removed] : []);
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] font-medium text-muted-foreground">
          {effUnits.length > 0 ? `Units (${effUnits.length})` : "Units"}
        </div>
        {onSaveLevelUnits && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 px-1.5 text-[10px] gap-1"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? (
              <>
                <XIcon className="h-3 w-3" />
                Close
              </>
            ) : (
              <>
                <Plus className="h-3 w-3" />
                Add
              </>
            )}
          </Button>
        )}
      </div>

      {open && onSaveLevelUnits && (
        <div className="rounded-md border bg-popover">
          <div className="p-1.5 border-b">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search or create unit…"
              className="h-7 text-xs"
            />
          </div>
          <div
            className="max-h-48 overflow-y-auto overscroll-contain"
            onWheel={(e) => e.stopPropagation()}
          >
            {filtered.length === 0 && !showCreate && (
              <div className="text-[11px] italic text-muted-foreground px-2 py-2">
                No units.
              </div>
            )}
            {filtered.map((ref) => {
              const count = counts.get(ref) || 0;
              return (
                <div
                  key={ref}
                  className="flex items-center gap-2 px-2 py-1 text-xs hover:bg-muted/50"
                >
                  <span className="flex-1 min-w-0 truncate" title={ref}>
                    {ref}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    {count > 0 && (
                      <>
                        <button
                          type="button"
                          onClick={() => void decrement(ref)}
                          className="h-5 w-5 inline-flex items-center justify-center rounded border hover:bg-muted"
                          aria-label={`Remove one ${ref}`}
                        >
                          <span className="text-xs leading-none">−</span>
                        </button>
                        <span className="min-w-[1rem] text-center text-[11px] font-medium tabular-nums">
                          {count}
                        </span>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => void increment(ref)}
                      className="h-5 w-5 inline-flex items-center justify-center rounded border hover:bg-muted"
                      aria-label={`Add ${ref}`}
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              );
            })}
            {showCreate && (
              <div className="flex items-center gap-2 px-2 py-1 text-xs hover:bg-muted/50 border-t">
                <span className="flex-1 min-w-0 truncate italic text-muted-foreground">
                  Create "{q}"
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    const name = q;
                    setQuery("");
                    await increment(name);
                  }}
                  className="h-5 w-5 inline-flex items-center justify-center rounded border hover:bg-muted shrink-0"
                  aria-label={`Create and add ${q}`}
                >
                  <Plus className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {effUnits.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {effUnits.map((u, idx) => (
            <span
              key={`${u}::${idx}`}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border"
              style={{
                backgroundColor: softBgFrom(uc),
                color: uc,
                borderColor: uc,
              }}
            >
              {u}
              {onSaveLevelUnits && (
                <button
                  type="button"
                  onClick={() => void removeOneAt(idx)}
                  className="hover:opacity-70"
                  aria-label={`Remove ${u}`}
                >
                  <XIcon className="h-2.5 w-2.5" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {onPlaceUnitBbox && (
        <PlaceUnitBboxControl
          planId={fp.plan_id}
          onPlace={() => void onPlaceUnitBbox(fp.plan_id)}
        />
      )}
    </div>
  );
};

interface PlaceUnitBboxControlProps {
  planId: string;
  onPlace: () => void;
}

const PlaceUnitBboxControl = ({ onPlace }: PlaceUnitBboxControlProps) => {
  return (
    <div className="pt-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-6 px-2 text-[11px] gap-1"
        onClick={onPlace}
      >
        <Plus className="h-3 w-3" />
        Place Unit Floor Plan Marker
      </Button>
    </div>
  );
};


// ============================================================================
// Per-page vector-PDF download dialog. Opened from the drawing modal's toolbar
// (Download button replaces the fit-page button). Loads the original PDF via
// the shared source resolver, extracts the currently visible page, and stamps
// the overlay layer on top (when the checkbox is enabled).
// ============================================================================
function PageDownloadDialog({
  open,
  onOpenChange,
  busy,
  setBusy,
  includeOverlays,
  setIncludeOverlays,
  source,
  downloadSource,
  page,
  overlays,
  fileName,
  userRotation = 0,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  busy: boolean;
  setBusy: (v: boolean) => void;
  includeOverlays: boolean;
  setIncludeOverlays: (v: boolean) => void;
  source: DocumentSourceDescriptor | null;
  downloadSource?: DocumentSourceDescriptor | null;
  page: number;
  overlays: OverlayInput[];
  fileName: string;
  userRotation?: 0 | 90 | 180 | 270;
}) {
  const { toast } = useToast();

  const outputName = useMemo(() => {
    const base = (fileName || "drawing").replace(/\.[^.]+$/, "");
    return `${base}_page${page}.pdf`;
  }, [fileName, page]);

  const handleDownload = async () => {
    const sourceToDownload = downloadSource ?? source;
    if (busy || !sourceToDownload) return;
    setBusy(true);
    try {
      const { resolveDocumentSource } = await import(
        "@/components/viewer/hooks/useDocumentSource"
      );
      const { buildAnnotatedPdf, triggerPdfDownload } = await import(
        "@/lib/pdfPageOverlayExport"
      );

      const { blob, mime } = await resolveDocumentSource(sourceToDownload);
      if (!mime.toLowerCase().includes("pdf")) {
        toast({
          title: "Not a PDF",
          description: "Only PDF drawings can be downloaded from this dialog.",
          variant: "destructive",
        });
        return;
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const merged = await buildAnnotatedPdf(
        [
          {
            fileName,
            sourceBytes: bytes,
            source,
            pages: [{ page, overlays: overlays as any[], userRotation }],
          },
        ],
        { includeOverlays },
      );
      triggerPdfDownload(merged, outputName);
      onOpenChange(false);
    } catch (e: any) {
      toast({
        title: "Download failed",
        description: e?.message || "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (busy ? null : onOpenChange(v))}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Download page</DialogTitle>
        </DialogHeader>

        <div className="text-sm">
          <div className="text-muted-foreground">File name</div>
          <div className="font-mono text-xs mt-1 truncate">{outputName}</div>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <input
            id="page-download-overlays"
            type="checkbox"
            className="h-4 w-4"
            checked={includeOverlays}
            disabled={busy}
            onChange={(e) => setIncludeOverlays(e.target.checked)}
          />
          <label
            htmlFor="page-download-overlays"
            className="text-sm cursor-pointer"
          >
            Include annotations &amp; detail boxes
          </label>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button onClick={handleDownload} disabled={busy || !(downloadSource ?? source)}>
            {busy ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : null}
            Download
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}




