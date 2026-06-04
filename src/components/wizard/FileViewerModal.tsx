import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronDown, ChevronRight, Loader2, Redo2, Undo2 } from "lucide-react";
import { DrawingViewer } from "@/components/viewer";
import type {
  DocumentSourceDescriptor,
  OverlayInput,
} from "@/components/viewer";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { getUserFriendlyError } from "@/lib/errorHandling";
import { awpClassColor } from "@/lib/awpColor";

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
}

interface FileViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  fileId: string;
  fileName: string;
  mimeType: string;
  accessToken: string;
  detections: SystemDetection[];
  sourceOverride?: DocumentSourceDescriptor;
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
}: FileViewerModalProps) => {
  const { toast } = useToast();
  const [hoveredCode, setHoveredCode] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  const sidebarEnabled =
    !!awpClasses && !!analysisRequestId && !!parentFileId;

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

  // Reset history on open. Selected class is re-synced from localStorage.
  // Expansion state is NOT reset — it should persist across modal opens
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
        .select("id, awp_class_name, nx, ny, page_index, file_id, created_at, instance_number")
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
        .select("id, awp_class_name, nx, ny, page_index, file_id, created_at, instance_number")
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

  // When viewing a per-sheet PDF (sheetId provided), the rendered PDF only
  // has a single page (currentPage === 1) but instances are persisted under
  // their original `pageIndex` from the source document. When viewing the
  // full multi-page parent PDF, instances live on whatever page the user is
  // currently on.
  const effectivePage = sheetId ? pageIndex : currentPage;

  // ---- User-initiated actions ---------------------------------------------
  const handleCanvasClick = async (nx: number, ny: number) => {
    if (!sidebarEnabled || !selectedClass) return;
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
  };

  const handleOverlayClick = async (overlayId: string) => {
    if (!sidebarEnabled) return;
    const instId = overlayId.startsWith("inst-") ? overlayId.slice(5) : overlayId;
    const inst = instances.find((i) => i.id === instId);
    if (!inst) return;
    const ok = await dbDelete(inst.id);
    if (!ok) return;
    setInstances((prev) => prev.filter((i) => i.id !== inst.id));
    setPast((p) => [...p, { type: "delete", instance: inst }]);
    setFuture([]);
  };

  const handleDeleteFromList = async (id: string) => {
    const inst = instances.find((i) => i.id === id);
    if (!inst) return;
    const ok = await dbDelete(id);
    if (!ok) return;
    setInstances((prev) => prev.filter((i) => i.id !== id));
    setPast((p) => [...p, { type: "delete", instance: inst }]);
    setFuture([]);
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
  // — gaps remain and the next added marker continues past the highest ID.
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

  const instanceLabel = (inst: DrawingInstanceRow) => {
    const n = numberByInstanceId.get(inst.id) ?? 0;
    const prefix = prefixByClass.get(inst.awp_class_name) || "AWP";
    return `${prefix}-${String(n).padStart(3, "0")}`;
  };

  // ---- Overlays ----------------------------------------------------------
  const detectionOverlays: OverlayInput[] = useMemo(() => {
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
  }, [detections]);

  // User-placed circles, but only for THIS file and current page.
  // In sheet mode the rendered PDF has exactly one page (1), so overlay.page
  // must be 1 regardless of the instance's original page_index.
  const instanceOverlays: OverlayInput[] = useMemo(() => {
    return instances
      .filter(
        (i) => i.file_id === parentFileId && i.page_index === effectivePage,
      )
      .map((i) => ({
        id: `inst-${i.id}`,
        // bbox width/height = 0 so the centroid is exactly the click point
        bbox: [i.nx, i.ny, 0, 0] as [number, number, number, number],
        coordSpace: "normalized" as const,
        page: sheetId ? 1 : i.page_index,
        color: awpClassColor(i.awp_class_name),
        label: instanceLabel(i),
      }));
  }, [instances, effectivePage, sheetId, parentFileId, numberByInstanceId, prefixByClass]);

  const overlays = [...detectionOverlays, ...instanceOverlays];

  // For the sidebar: instances for THIS file, on the current page, grouped by class.
  const instancesByClassThisFile = useMemo(() => {
    const m = new Map<string, DrawingInstanceRow[]>();
    for (const i of instances) {
      if (i.file_id !== parentFileId) continue;
      if (i.page_index !== effectivePage) continue;
      const arr = m.get(i.awp_class_name) || [];
      arr.push(i);
      m.set(i.awp_class_name, arr);
    }
    return m;
  }, [instances, parentFileId, effectivePage]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-[95vw] w-[95vw] h-[90vh] flex flex-col p-4 [&>button]:top-4 [&>button]:right-4">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="truncate">{fileName}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-1 gap-4 overflow-hidden min-h-0">
          <div className="flex-1 border rounded-lg overflow-hidden bg-muted/30 min-h-0">
            <DrawingViewer
              source={source}
              layout="single-page"
              page={currentPage}
              onPageChange={setCurrentPage}
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
            />
          </div>

          {sidebarEnabled && awpClasses ? (
            <div className="w-72 flex-shrink-0 border rounded-lg flex flex-col">
              <div className="px-3 py-2 border-b flex items-start justify-between gap-2">
                <div>
                  <h4 className="text-sm font-medium">AWP classes</h4>
                  <p className="text-[11px] text-muted-foreground">
                    Click the canvas to mark; click a marker to remove.
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={undo}
                    disabled={past.length === 0}
                    aria-label="Undo"
                    title="Undo"
                  >
                    <Undo2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={redo}
                    disabled={future.length === 0}
                    aria-label="Redo"
                    title="Redo"
                  >
                    <Redo2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto overflow-x-hidden min-w-0">
                <div className="py-1 w-full min-w-0">
                  {loadingInstances && (
                    <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /> Loading
                      markers…
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
                          className={`flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-muted/50 min-w-0 ${
                            isSelected ? "bg-muted/40" : ""
                          }`}
                          onClick={() => setSelectedClass(c.name)}
                        >
                          <input
                            type="radio"
                            checked={isSelected}
                            onChange={() => setSelectedClass(c.name)}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedClass(c.name);
                            }}
                            className="h-3.5 w-3.5 shrink-0"
                          />
                          <span
                            className="h-2 w-2 rounded-full shrink-0"
                            style={{ backgroundColor: color }}
                          />
                          <span className="font-mono text-xs text-muted-foreground shrink-0">
                            {c.prefix ?? "—"}
                          </span>
                          <span className="flex-1 min-w-0 truncate" title={c.name}>{c.name}</span>
                          <span className="text-xs tabular-nums text-muted-foreground shrink-0">
                            {total}
                          </span>
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
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </button>
                        </div>
                        {isExpanded && (
                          <div className="px-8 py-1 space-y-1 bg-muted/20">
                            {c.analysisCount > 0 && (
                              <div className="text-[11px] text-muted-foreground">
                                {c.analysisCount} from analysis
                              </div>
                            )}
                            {subList.length === 0 && c.analysisCount === 0 && (
                              <div className="text-[11px] text-muted-foreground italic">
                                No instances yet.
                              </div>
                            )}
                            {subList
                              .slice()
                              .sort(
                                (a, b) =>
                                  (numberByInstanceId.get(a.id) ?? 0) -
                                  (numberByInstanceId.get(b.id) ?? 0),
                              )
                              .map((i) => (
                                <div
                                  key={i.id}
                                  className="flex items-center gap-2 text-[11px]"
                                >
                                  <span
                                    className="h-2 w-2 rounded-full shrink-0"
                                    style={{ backgroundColor: color }}
                                  />
                                  <span className="flex-1 min-w-0 font-mono truncate">
                                    {instanceLabel(i)}
                                    {i.page_index !== effectivePage
                                      ? ` (p.${i.page_index})`
                                      : ""}
                                  </span>
                                  <button
                                    onClick={() => handleDeleteFromList(i.id)}
                                    className="shrink-0 text-muted-foreground hover:text-destructive px-1"
                                    aria-label="Remove marker"
                                  >
                                    ×
                                  </button>
                                </div>
                              ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : detections.length > 0 ? (
            <div className="w-64 flex-shrink-0 border rounded-lg p-3 flex flex-col">
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
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
};
