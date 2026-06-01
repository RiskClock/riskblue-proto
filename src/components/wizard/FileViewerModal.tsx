import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { DrawingViewer } from "@/components/viewer";
import type {
  DocumentSourceDescriptor,
  OverlayInput,
} from "@/components/viewer";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { getUserFriendlyError } from "@/lib/errorHandling";

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
  /** When provided, enables the AWP-class sidebar + click-to-mark feature. */
  awpClasses?: AwpClassOption[];
  /** Analysis-request id used to persist instances. */
  analysisRequestId?: string;
  /** Parent analysis_request_files id (used as instance scope). */
  parentFileId?: string;
  /** Optional sheet (page) id; null for single-page files. */
  sheetId?: string | null;
  /** Page index of the active sheet (defaults to 1). */
  pageIndex?: number;
}

const BOUNDING_BOX_COLOR = "#39FF14"; // legacy detections (green)
const INSTANCE_COLOR = "#ef4444"; // user-placed red circles

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
}: FileViewerModalProps) => {
  const { toast } = useToast();
  const [hoveredCode, setHoveredCode] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  const sidebarEnabled =
    !!awpClasses && !!analysisRequestId && !!parentFileId;

  const [selectedClass, setSelectedClass] = useState<string | null>(
    awpClasses?.[0]?.name ?? null,
  );
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [instances, setInstances] = useState<DrawingInstanceRow[]>([]);
  const [loadingInstances, setLoadingInstances] = useState(false);

  useEffect(() => {
    if (isOpen && awpClasses && awpClasses.length > 0 && !selectedClass) {
      setSelectedClass(awpClasses[0].name);
    }
  }, [isOpen, awpClasses, selectedClass]);

  // Load instances for this file
  useEffect(() => {
    if (!isOpen || !sidebarEnabled) return;
    let cancelled = false;
    (async () => {
      setLoadingInstances(true);
      const { data, error } = await supabase
        .from("drawing_instances" as any)
        .select("id, awp_class_name, nx, ny, page_index")
        .eq("analysis_request_id", analysisRequestId!)
        .eq("file_id", parentFileId!);
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
  }, [isOpen, sidebarEnabled, analysisRequestId, parentFileId, toast]);

  const handleCanvasClick = async (nx: number, ny: number) => {
    if (!sidebarEnabled || !selectedClass) return;
    // Optimistic insert
    const tempId = `tmp-${Date.now()}`;
    const optimistic: DrawingInstanceRow = {
      id: tempId,
      awp_class_name: selectedClass,
      nx,
      ny,
      page_index: pageIndex,
    };
    setInstances((prev) => [...prev, optimistic]);
    const { data, error } = await supabase
      .from("drawing_instances" as any)
      .insert({
        analysis_request_id: analysisRequestId!,
        file_id: parentFileId!,
        sheet_id: sheetId ?? null,
        awp_class_name: selectedClass,
        nx,
        ny,
        page_index: pageIndex,
      } as any)
      .select("id, awp_class_name, nx, ny, page_index")
      .single();
    if (error) {
      setInstances((prev) => prev.filter((i) => i.id !== tempId));
      toast({
        variant: "destructive",
        title: "Could not save marker",
        description: getUserFriendlyError(error),
      });
      return;
    }
    setInstances((prev) =>
      prev.map((i) =>
        i.id === tempId ? ((data as unknown) as DrawingInstanceRow) : i,
      ),
    );
  };

  const deleteInstance = async (id: string) => {
    const prev = instances;
    setInstances((p) => p.filter((i) => i.id !== id));
    const { error } = await supabase
      .from("drawing_instances" as any)
      .delete()
      .eq("id", id);
    if (error) {
      setInstances(prev);
      toast({
        variant: "destructive",
        title: "Could not delete marker",
        description: getUserFriendlyError(error),
      });
    }
  };

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

  // Legacy detection overlays
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

  // Instance overlays (user-placed red circles for selected page)
  const instanceOverlays: OverlayInput[] = useMemo(() => {
    return instances
      .filter((i) => i.page_index === currentPage)
      .map((i) => ({
        id: `inst-${i.id}`,
        bbox: [i.nx, i.ny, 0.01, 0.01] as [number, number, number, number],
        coordSpace: "normalized" as const,
        page: i.page_index,
        color: INSTANCE_COLOR,
      }));
  }, [instances, currentPage]);

  const overlays = [...detectionOverlays, ...instanceOverlays];

  const instancesByClass = useMemo(() => {
    const m = new Map<string, DrawingInstanceRow[]>();
    for (const i of instances) {
      const arr = m.get(i.awp_class_name) || [];
      arr.push(i);
      m.set(i.awp_class_name, arr);
    }
    return m;
  }, [instances]);

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
            />
          </div>

          {sidebarEnabled && awpClasses ? (
            <div className="w-72 flex-shrink-0 border rounded-lg flex flex-col">
              <div className="px-3 py-2 border-b">
                <h4 className="text-sm font-medium">AWP classes</h4>
                <p className="text-[11px] text-muted-foreground">
                  Click the canvas to mark an instance of the selected class.
                </p>
              </div>
              <ScrollArea className="flex-1">
                <div className="py-1">
                  {loadingInstances && (
                    <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /> Loading
                      markers…
                    </div>
                  )}
                  {awpClasses.map((c) => {
                    const userCount =
                      instancesByClass.get(c.name)?.length ?? 0;
                    const total = c.analysisCount + userCount;
                    const isSelected = selectedClass === c.name;
                    const isExpanded = expanded.has(c.name);
                    const subList = instancesByClass.get(c.name) || [];
                    return (
                      <div key={c.name} className="border-b last:border-b-0">
                        <div
                          className={`flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-muted/50 ${
                            isSelected ? "bg-muted/40" : ""
                          }`}
                          onClick={() => setSelectedClass(c.name)}
                        >
                          <input
                            type="radio"
                            checked={isSelected}
                            onChange={() => setSelectedClass(c.name)}
                            className="h-3.5 w-3.5"
                          />
                          <span className="font-mono text-xs text-muted-foreground">
                            {c.prefix ?? "—"}
                          </span>
                          <span className="flex-1 truncate">{c.name}</span>
                          <span className="text-xs tabular-nums text-muted-foreground">
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
                            className="text-muted-foreground hover:text-foreground"
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
                            {subList.map((i, idx) => (
                              <div
                                key={i.id}
                                className="flex items-center gap-2 text-[11px]"
                              >
                                <span className="h-2 w-2 rounded-full bg-destructive" />
                                <span className="flex-1">
                                  Marker {idx + 1}
                                  {i.page_index !== currentPage
                                    ? ` (p.${i.page_index})`
                                    : ""}
                                </span>
                                <button
                                  onClick={() => deleteInstance(i.id)}
                                  className="text-muted-foreground hover:text-destructive"
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
              </ScrollArea>
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
