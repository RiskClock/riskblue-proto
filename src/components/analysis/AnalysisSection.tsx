import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAnalysisRequestState } from "@/hooks/useAnalysisRequestState";
import { useSharedAnalysisRequestState } from "@/contexts/AnalysisRequestStateContext";
import { Button } from "@/components/ui/button";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Loader2,
  Play,
  Square,
  XCircle,
  ExternalLink,
  ScanLine,
  FileText,
  PlusCircle,
  Eye,
  RotateCcw,
  AlertTriangle,
  Download,
  Copy,
  Check,
  Search,
  FileSearch,
  Info,
  Upload,
  MoreVertical,
  Trash2,
  X,
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
import { DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { BuyCreditsModal } from "@/components/BuyCreditsModal";
import { useCredits } from "@/hooks/useCredits";
import * as pdfjsLib from "pdfjs-dist";
import { DrawingViewer } from "@/components/viewer";
import type { DocumentSourceDescriptor, OverlayInput } from "@/components/viewer";

// Configure PDF.js worker (idempotent — safe to call multiple times)
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url
).toString();

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface AnalysisFile {
  id: string;
  name: string;
  storage_path: string | null;
  copy_status: string;
  size_bytes?: number | null;
  extracted_text?: string | null;
}

interface AWPPrompt {
  id: string;
  awp_class_name: string;
  category: string;
  drive_file_id: string | null;
  drive_file_name: string | null;
  drive_file_url: string | null;
  prompt_content: string | null;
  triage_prompt_content: string | null;
  detection_method: string;
  condition_rule: Record<string, any> | null;
}

interface AnalysisResult {
  id: string;
  file_id: string;
  awp_class_name: string;
  result_text: string | null;
  status: string;
  error_message: string | null;
}

interface TriageResult {
  file_id: string;
  awp_class_name: string;
  status: string;
  score: number | null;
  reason: string | null;
  error_message: string | null;
  instances: number | null;
}

interface ParsedInstance {
  id: string;
  name: string;
  level: string;
  size: string;
}

interface SummarizedInstance {
  id: string;
  name: string;
  floor: string;
  area_sqft: number;
  notes: string;
  pipe_diameter_mm?: number;
}

interface AnalysisSectionProps {
  requestId: string;
  files: AnalysisFile[];
  projectId: string;
  sourceType?: string;
  isWMSV?: boolean;
  visibleAwpClasses?: string[];
  onAddFileUpload?: () => void;
  onAddFileDrive?: () => void;
  onAddFileProcore?: () => void;
  onAddFileSharePoint?: () => void;
}

// ---------------------------------------------------------------------------
// Helpers: extract room tag IDs from AI result text (table format)
// ---------------------------------------------------------------------------

/**
 * Parse the AI result text (markdown table) and return all room-tag strings
 * found in the "Room Code / Generated Room Code / ID" column.
 * Also extracts the page number if present.
 */
function parseRoomTagsFromResult(
  resultText: string
): Array<{ tag: string; pageNum: number }> {
  const rows = parseOverlayCandidates(resultText);
  // Return the first candidate per row as the primary tag (backward compat)
  return rows
    .filter((r) => r.candidates.length > 0)
    .map((r) => ({ tag: r.candidates[0], pageNum: r.pageNum }));
}

// ---------------------------------------------------------------------------
// Multi-candidate overlay parser — returns all searchable strings per row
// ---------------------------------------------------------------------------

interface OverlayRow {
  candidates: string[];   // ordered by search priority
  pageNum: number;
  aiBBox?: { x1: number; y1: number; x2: number; y2: number };
}

/**
 * Parse the AI result markdown table and return multiple search candidates
 * per row.  Priority order for candidate columns:
 *   1. generated room code / room code / identifier / tag
 *   2. drawing code / drawing label
 *   3. component / name
 *   4. first data column (fallback)
 *
 * Each non-empty value from these columns becomes a candidate the caller
 * can try against the PDF text layer.
 */
function parseOverlayCandidates(resultText: string): OverlayRow[] {
  try {
    const lines = resultText.split("\n").filter((l) => l.includes("|"));
    if (lines.length < 2) return [];

    // Find header row
    let headerIdx = -1;
    const HEADER_KW = ["room code", "generated room", "code", "id", "label", "name", "component", "type", "identifier", "tag", "drawing"];
    for (let i = 0; i < lines.length; i++) {
      const low = lines[i].toLowerCase();
      if (HEADER_KW.some((k) => low.includes(k)) && (lines[i].match(/\|/g) || []).length >= 2) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx === -1) return [];

    const headers = lines[headerIdx].split("|").map((c) => c.trim().toLowerCase());
    const pageCol = headers.findIndex((h) => h.includes("page") || h.includes("sheet"));
    const bboxCol = headers.findIndex((h) => h.includes("bounding box") || h.includes("bbox") || h.includes("coordinates"));

    // Build candidate column indices in priority order
    const candidateColIndices: number[] = [];
    const colPriority: Array<(h: string) => boolean> = [
      (h) => h === "id" || h.includes("room code") || h.includes("generated room") || h.includes("room identifier") || ((h.includes("code") || h.includes("identifier") || h.includes("tag")) && !h.includes("drawing")),
      (h) => h.includes("drawing code") || h.includes("drawing label") || (h.includes("label") && !h.includes("page")),
      (h) => h.includes("component type") || h.includes("component"),
      (h) => h === "name" || h.includes("name"),
    ];

    for (const matcher of colPriority) {
      for (let ci = 0; ci < headers.length; ci++) {
        if (matcher(headers[ci]) && !candidateColIndices.includes(ci) && ci !== pageCol) {
          candidateColIndices.push(ci);
        }
      }
    }

    // Fallback: if nothing matched, use first data column (index 1)
    if (candidateColIndices.length === 0 && headers.length > 1) {
      candidateColIndices.push(1);
    }

    const dataLines = lines.slice(headerIdx + 1).filter((l) => !l.match(/^[\s|:-]+$/));
    const rows: OverlayRow[] = [];

    for (const line of dataLines) {
      const cells = line.split("|").map((c) => c.trim());
      const candidates: string[] = [];
      const seenCandidates = new Set<string>();
      for (const ci of candidateColIndices) {
        const val = cells[ci];
        if (val && val !== "-" && !val.toLowerCase().includes("none") && !val.toLowerCase().includes("no instance") && val.length > 1) {
          const normalized = normalizeText(val);
          if (!seenCandidates.has(normalized)) {
            seenCandidates.add(normalized);
            candidates.push(val);
          }
        }
      }
      let pageNum = 1;
      if (pageCol !== -1) {
        const pv = parseInt(cells[pageCol] || "1", 10);
        if (!isNaN(pv) && pv > 0) pageNum = pv;
      }
      // Parse AI bounding box if column exists
      let aiBBox: OverlayRow["aiBBox"] = undefined;
      if (bboxCol !== -1) {
        const bboxStr = cells[bboxCol] || "";
        // Match patterns like (1848, 2665) → (1975, 2681) or (1848, 2665) -> (1975, 2681)
        const bboxMatch = bboxStr.match(/\(?\s*(\d+)[,\s]+(\d+)\s*\)?\s*(?:→|->|—|–)\s*\(?\s*(\d+)[,\s]+(\d+)\s*\)?/);
        if (bboxMatch) {
          aiBBox = {
            x1: parseInt(bboxMatch[1], 10),
            y1: parseInt(bboxMatch[2], 10),
            x2: parseInt(bboxMatch[3], 10),
            y2: parseInt(bboxMatch[4], 10),
          };
        }
      }
      if (candidates.length > 0) {
        rows.push({ candidates, pageNum, aiBBox });
      }
    }
    return rows;
  } catch {
    return [];
  }
}

// Re-export shared text-layer search utilities
import { findBBoxInTextLayer, normalizeText, itemBBox, type PDFBBox } from "@/lib/pdfTextLayerSearch";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesDetectionId(candidate: string, targetId: string, allowBounded = false): boolean {
  const normalizedCandidate = normalizeText(candidate);
  const normalizedTarget = normalizeText(targetId);
  if (!normalizedCandidate || !normalizedTarget) return false;
  if (normalizedCandidate === normalizedTarget) return true;
  if (!allowBounded) return false;

  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(normalizedTarget)}([^a-z0-9]|$)`, "i").test(normalizedCandidate);
}

function findMatchingOverlayRow(rows: OverlayRow[], targetId: string): OverlayRow | undefined {
  return rows.find((row) => row.candidates.some((candidate) => matchesDetectionId(candidate, targetId)))
    ?? rows.find((row) => row.candidates.some((candidate) => matchesDetectionId(candidate, targetId, true)));
}

function buildOverlaySearchCandidates(row: OverlayRow | undefined, instance: Pick<SummarizedInstance, "id" | "name">): string[] {
  const values = [instance.id, ...(row?.candidates ?? []), instance.name];
  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    const normalized = normalizeText(trimmed);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    ordered.push(trimmed);
  }

  return ordered;
}

// ---------------------------------------------------------------------------
// InstanceDetailModal — migrated to the shared DrawingViewer
// ---------------------------------------------------------------------------
//
// Coordinate model (preserved from previous implementation):
//   - AI bbox: pixel coordinates in the scale-4 raster of the source page.
//   - Text-layer fallback: PDF user-space points (origin bottom-left).
//
// We resolve the matching overlay row + bbox + page once on mount, then hand
// the source + a single `OverlayInput` to the shared viewer with
// initialFit="selection" so it auto-zooms to the bbox using the shared
// fit-to-rect math. All wheel/drag/zoom math now lives in the shared viewer.

interface ResolvedOverlay {
  pageNum: number;
  bbox: [number, number, number, number];
  coordSpace: "pixels" | "pdf-points";
  pixelSize?: { w: number; h: number };
  pdfViewport?: pdfjsLib.PageViewport;
}

interface InstanceDetailModalProps {
  instance: SummarizedInstance;
  awpClassName: string;
  sourceFile: AnalysisFile | undefined;
  resultText: string | undefined;
  sourceType?: string;
  onClose: () => void;
}

function InstanceDetailModal({
  instance,
  awpClassName,
  sourceFile,
  resultText,
  sourceType,
  onClose,
}: InstanceDetailModalProps) {
  const [resolvedOverlay, setResolvedOverlay] = useState<ResolvedOverlay | null>(null);
  const [resolveLoading, setResolveLoading] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  const bucket = sourceType === "manual_upload" ? "uploaded-drawings" : "drive-analysis-files";

  // Source descriptor for the shared viewer (storage-backed PDF).
  const source: DocumentSourceDescriptor | null = useMemo(() => {
    if (!sourceFile?.storage_path) return null;
    return { kind: "supabase-storage", bucket, path: sourceFile.storage_path };
  }, [sourceFile?.storage_path, bucket]);

  // Resolve the matching overlay (page + bbox) — runs once per modal open.
  // We need pdfViewport / pixelSize for coordinate normalization, so we
  // download the PDF and inspect the target page here. The shared viewer will
  // download and raster the same blob; both go through the storage cache so
  // the cost is acceptable and we avoid re-architecting the viewer to expose
  // resolved per-page metadata externally.
  useEffect(() => {
    if (!sourceFile?.storage_path) {
      setResolvedOverlay(null);
      return;
    }
    let cancelled = false;
    setResolveLoading(true);
    setResolveError(null);
    setResolvedOverlay(null);

    (async () => {
      try {
        const { data: blob, error: dlErr } = await supabase.storage
          .from(bucket)
          .download(sourceFile.storage_path!);
        if (dlErr || !blob) throw dlErr || new Error("Download failed");
        const ab = await blob.arrayBuffer();
        if (cancelled) return;

        const overlayRows = resultText ? parseOverlayCandidates(resultText) : [];
        const matchingRow = findMatchingOverlayRow(overlayRows, instance.id);
        const searchCandidates = buildOverlaySearchCandidates(matchingRow, instance);
        const hintPage = matchingRow?.pageNum;
        const matchedAiBBox = matchingRow?.aiBBox;

        console.log(`[BBox] opening: instance.id=${instance.id} instance.name=${instance.name}`);
        console.log(`[BBox] searchCandidates=`, searchCandidates, `hintPage=${hintPage}`, `aiBBox=`, matchedAiBBox);

        const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
        if (cancelled) return;

        let textBBox: PDFBBox | null = null;
        if (!matchedAiBBox) {
          for (const candidate of searchCandidates) {
            textBBox = await findBBoxInTextLayer(pdf, candidate, hintPage);
            if (textBBox) break;
            if (cancelled) return;
          }
        }
        if (cancelled) return;

        const targetPage = textBBox?.pageNum ?? hintPage ?? 1;
        const pageNum = Math.min(targetPage, pdf.numPages);
        const page = await pdf.getPage(pageNum);
        if (cancelled) return;

        // Match the legacy raster scale so AI pixel bboxes map 1:1.
        const viewport = page.getViewport({ scale: 4 });

        if (matchedAiBBox) {
          setResolvedOverlay({
            pageNum,
            bbox: [matchedAiBBox.x1, matchedAiBBox.y1, matchedAiBBox.x2, matchedAiBBox.y2],
            coordSpace: "pixels",
            pixelSize: { w: viewport.width, h: viewport.height },
          });
        } else if (textBBox) {
          setResolvedOverlay({
            pageNum,
            bbox: [textBBox.x1, textBBox.y1, textBBox.x2, textBBox.y2],
            coordSpace: "pdf-points",
            pdfViewport: viewport,
          });
        } else {
          // No match — open the modal at fit-page with no overlay.
          setResolvedOverlay(null);
        }
      } catch (e) {
        if (!cancelled) {
          console.error("Overlay resolve error:", e);
          setResolveError("Failed to resolve drawing.");
        }
      } finally {
        if (!cancelled) setResolveLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [sourceFile?.storage_path, instance.id, instance.name, resultText, bucket]);

  // Build the single overlay for the shared viewer.
  const OVERLAY_ID = "instance-bbox";
  const overlays: OverlayInput[] = useMemo(() => {
    if (!resolvedOverlay) return [];
    return [{
      id: OVERLAY_ID,
      page: resolvedOverlay.pageNum,
      bbox: resolvedOverlay.bbox,
      coordSpace: resolvedOverlay.coordSpace,
      pixelSize: resolvedOverlay.pixelSize,
      pdfViewport: resolvedOverlay.pdfViewport,
      color: "hsl(var(--destructive))",
      label: instance.id,
      // Exact-location emphasis → translucent circle marker.
      shape: "circle",
    }];
  }, [resolvedOverlay, instance.id]);

  // Display string for the bounding-box readout (preserves prior UI).
  const bboxReadout = resolvedOverlay
    ? `(${Math.round(resolvedOverlay.bbox[0])}, ${Math.round(resolvedOverlay.bbox[1])}) → (${Math.round(resolvedOverlay.bbox[2])}, ${Math.round(resolvedOverlay.bbox[3])})`
    : null;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-5xl h-[85vh] flex flex-col p-0">
        {/* Fixed header */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b flex-shrink-0">
          <DialogTitle>
            {awpClassName} — <span className="font-mono text-sm">{instance.id}</span>
          </DialogTitle>
        </DialogHeader>

        {/* Body: left info panel + right drawing area */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Left panel */}
          <div className="w-56 flex-shrink-0 border-r overflow-y-auto p-6 space-y-4">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Name</p>
              <p className="text-sm font-medium">{instance.name || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Floor</p>
              <p className="text-sm">{instance.floor || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Area (sqft)</p>
              <p className="text-sm">{instance.area_sqft > 0 ? instance.area_sqft : "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Bounding Box</p>
              {bboxReadout ? (
                <p className="text-xs font-mono text-muted-foreground leading-relaxed">
                  {bboxReadout}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">—</p>
              )}
            </div>
            {instance.notes && (
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Notes</p>
                <p className="text-sm text-muted-foreground leading-relaxed">{instance.notes}</p>
              </div>
            )}
            {sourceFile && (
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Source File</p>
                <p className="text-xs text-muted-foreground truncate" title={sourceFile.name}>{sourceFile.name}</p>
              </div>
            )}
          </div>

          {/* Right: shared DrawingViewer (owns toolbar, zoom/pan, fit) */}
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
            {!sourceFile?.storage_path ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-sm text-muted-foreground">Drawing not available</p>
              </div>
            ) : resolveError ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-sm text-destructive">{resolveError}</p>
              </div>
            ) : resolveLoading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <DrawingViewer
                source={source}
                layout="single-page"
                page={resolvedOverlay?.pageNum ?? 1}
                overlays={overlays}
                initialFit={resolvedOverlay ? "selection" : "page"}
                initialFitOverlayId={resolvedOverlay ? OVERLAY_ID : undefined}
                minScale={0.8}
                maxScale={8}
              />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// RawResultModal
// ---------------------------------------------------------------------------

interface RawResultModalProps {
  fileName: string;
  awpClassName: string;
  resultText: string;
  instanceCount: number;
  sourceFile?: AnalysisFile;
  sourceType?: string;
  onClose: () => void;
}

function RawResultModal({ fileName, awpClassName, resultText, instanceCount, sourceFile, sourceType, onClose }: RawResultModalProps) {
  // Resolve overlays once: build OverlayInputs in document coordinates so the
  // shared DrawingViewer owns rendering, interaction, and fit math. Stacked
  // multi-page behavior is preserved via layout="stacked-pages".
  const [resolveLoading, setResolveLoading] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [overlays, setOverlays] = useState<OverlayInput[]>([]);
  const [multiPagePage, setMultiPagePage] = useState(1);

  const bucket = sourceType === "manual_upload" ? "uploaded-drawings" : "drive-analysis-files";
  const storagePath = sourceFile?.storage_path ?? null;

  const source: DocumentSourceDescriptor | null = useMemo(() => {
    if (!storagePath) return null;
    return { kind: "supabase-storage", bucket, path: storagePath };
  }, [bucket, storagePath]);

  useEffect(() => {
    if (!storagePath) {
      setOverlays([]);
      setResolveError(null);
      return;
    }
    let cancelled = false;
    setResolveLoading(true);
    setResolveError(null);
    setOverlays([]);

    (async () => {
      try {
        const { data: blob, error: dlErr } = await supabase.storage
          .from(bucket)
          .download(storagePath);
        if (dlErr || !blob) throw dlErr || new Error("Download failed");
        const ab = await blob.arrayBuffer();
        if (cancelled) return;
        const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
        if (cancelled) return;

        const overlayRows = resultText ? parseOverlayCandidates(resultText) : [];
        // Cache per-page viewport at scale=4 to match the legacy AI raster
        // resolution, so AI pixel bboxes map 1:1.
        const viewportCache = new Map<number, any>();
        const getViewport = async (pageNum: number) => {
          const cached = viewportCache.get(pageNum);
          if (cached) return cached;
          const safePage = Math.min(Math.max(1, pageNum), pdf.numPages);
          const page = await pdf.getPage(safePage);
          const vp = page.getViewport({ scale: 4 });
          viewportCache.set(safePage, vp);
          return vp;
        };

        const built: OverlayInput[] = [];
        let idx = 0;
        for (const row of overlayRows) {
          const pageNum = Math.min(Math.max(1, row.pageNum), pdf.numPages);
          if (row.aiBBox) {
            const vp = await getViewport(pageNum);
            if (cancelled) return;
            built.push({
              id: `raw-${idx++}`,
              page: pageNum,
              bbox: [row.aiBBox.x1, row.aiBBox.y1, row.aiBBox.x2, row.aiBBox.y2],
              coordSpace: "pixels",
              pixelSize: { w: vp.width, h: vp.height },
              color: "hsl(var(--destructive))",
            });
          } else {
            // Text-layer fallback: try candidates until one matches
            for (const candidate of row.candidates) {
              const tb = await findBBoxInTextLayer(pdf, candidate, pageNum);
              if (cancelled) return;
              if (tb) {
                const tbPage = Math.min(Math.max(1, tb.pageNum ?? pageNum), pdf.numPages);
                const vp = await getViewport(tbPage);
                if (cancelled) return;
                built.push({
                  id: `raw-${idx++}`,
                  page: tbPage,
                  bbox: [tb.x1, tb.y1, tb.x2, tb.y2],
                  coordSpace: "pdf-points",
                  pdfViewport: vp,
                  color: "hsl(var(--destructive))",
                });
                break;
              }
            }
          }
        }
        if (cancelled) return;
        setOverlays(built);
      } catch (e) {
        if (!cancelled) {
          console.error("RawResultModal resolve error:", e);
          setResolveError("Could not render drawing.");
        }
      } finally {
        if (!cancelled) setResolveLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [storagePath, bucket, resultText]);

  const bboxCount = overlays.length;

  // Determine if all overlays are on a single page → enable auto-fit-to-all-detections.
  const detectionPages = useMemo(() => {
    const set = new Set<number>();
    for (const o of overlays) set.add(o.page ?? 1);
    return set;
  }, [overlays]);
  const singlePageDetections = detectionPages.size === 1;
  const detectionPage = singlePageDetections ? Array.from(detectionPages)[0] : 1;

  // Synthetic "fit-all" overlay covering the union of all detection bboxes on
  // a single page. We use coordSpace="pixels" to be invariant to AI vs text
  // matches (whichever produced the originals); we approximate by re-using
  // the first overlay's pixelSize/pdfViewport. The viewer already normalizes
  // coordinates per-page during fit math.
  const FIT_ALL_ID = "raw-fit-all";
  const overlaysWithFit = useMemo(() => {
    if (!singlePageDetections || overlays.length < 2) return overlays;
    const onPage = overlays.filter((o) => (o.page ?? 1) === detectionPage);
    if (onPage.length < 2) return overlays;
    // Compute union in each overlay's own coord space — only works if all
    // share the same coordSpace+ref. Group by coordSpace.
    const sameSpace = onPage.every((o) => o.coordSpace === onPage[0].coordSpace);
    if (!sameSpace) return overlays;
    const xs1: number[] = [], ys1: number[] = [], xs2: number[] = [], ys2: number[] = [];
    for (const o of onPage) {
      const [x1, y1, x2, y2] = o.bbox;
      xs1.push(x1); ys1.push(y1); xs2.push(x2); ys2.push(y2);
    }
    const union: OverlayInput = {
      id: FIT_ALL_ID,
      page: detectionPage,
      bbox: [Math.min(...xs1), Math.min(...ys1), Math.max(...xs2), Math.max(...ys2)],
      coordSpace: onPage[0].coordSpace,
      pixelSize: onPage[0].pixelSize,
      pdfViewport: onPage[0].pdfViewport,
      // Hidden — used only for fit math; render with no visible color.
      color: "transparent",
    };
    return [...overlays, union];
  }, [overlays, singlePageDetections, detectionPage]);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="!max-w-[95vw] h-[90vh] flex flex-col p-4 gap-2">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="font-mono text-sm truncate">{fileName}</DialogTitle>
          <p className="text-xs text-muted-foreground">
            {awpClassName} — {instanceCount} instance{instanceCount !== 1 ? "s" : ""} detected
            {bboxCount > 0 && ` · ${bboxCount} highlighted on drawing`}
          </p>
        </DialogHeader>
        <div className="flex flex-1 gap-3 min-h-0 overflow-hidden">
          {/* Left: Drawing viewer (stacked pages, owned by shared viewer) */}
          <div className="flex-[6] flex flex-col min-w-0 border rounded-lg overflow-hidden bg-muted/30">
            {!source ? (
              <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
                Drawing not available
              </div>
            ) : resolveError ? (
              <div className="flex items-center justify-center h-full text-xs text-destructive">
                {resolveError}
              </div>
            ) : resolveLoading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : singlePageDetections && overlays.length > 0 ? (
              <DrawingViewer
                source={source}
                layout="single-page"
                page={detectionPage}
                overlays={overlaysWithFit}
                initialFit="selection"
                initialFitOverlayId={overlays.length > 1 ? FIT_ALL_ID : overlays[0].id}
                minScale={0.8}
                maxScale={8}
              />
            ) : (
              <DrawingViewer
                source={source}
                layout="single-page"
                page={multiPagePage}
                onPageChange={setMultiPagePage}
                overlays={overlays}
                initialFit="page"
                minScale={0.8}
                maxScale={8}
              />
            )}
          </div>
          {/* Right: AI response text */}
          <div className="flex-[4] flex flex-col min-w-0 border rounded-lg overflow-hidden">
            <div className="h-10 flex-shrink-0 flex items-center px-3 border-b bg-background">
              <span className="text-xs text-muted-foreground">AI Response</span>
            </div>
            <div className="flex-1 overflow-auto p-3">
              <pre className="text-xs whitespace-pre-wrap font-mono">{resultText}</pre>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// FilePreviewModal
// ---------------------------------------------------------------------------

interface FilePreviewModalProps {
  file: AnalysisFile;
  sourceType?: string;
  onClose: () => void;
}

function FilePreviewModal({ file, sourceType, onClose }: FilePreviewModalProps) {
  const bucket = sourceType === "manual_upload" ? "uploaded-drawings" : "drive-analysis-files";
  const storagePath = file.storage_path ?? null;
  const [page, setPage] = useState(1);

  // Hint mime type from filename so PDF vs image is detected even if storage
  // doesn't return Content-Type. The shared loader falls back to blob.type.
  const lowerName = (file.name ?? "").toLowerCase();
  const mimeHint = lowerName.endsWith(".pdf")
    ? "application/pdf"
    : lowerName.endsWith(".png")
    ? "image/png"
    : lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")
    ? "image/jpeg"
    : undefined;

  const source: DocumentSourceDescriptor | null = useMemo(() => {
    if (!storagePath) return null;
    return { kind: "supabase-storage", bucket, path: storagePath, mimeType: mimeHint };
  }, [bucket, storagePath, mimeHint]);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-5xl h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-5 pb-3 border-b flex-shrink-0">
          <DialogTitle className="truncate text-sm font-mono">{file.name}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-hidden bg-muted/20">
          {!source ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-destructive">No file available.</p>
            </div>
          ) : (
            <DrawingViewer
              source={source}
              layout="single-page"
              page={page}
              onPageChange={setPage}
              initialFit="page"
              minScale={0.8}
              maxScale={8}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const HEADER_KEYWORDS = ["room code", "drawing label", "floor", "level", "notes", "code", "label", "name"];

function parseResultText(resultText: string): ParsedInstance[] {
  const lines = resultText.trim().split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];

  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const pipeCount = (line.match(/\|/g) || []).length;
    if (pipeCount < 3) continue;
    const lower = line.toLowerCase();
    if (HEADER_KEYWORDS.some((kw) => lower.includes(kw))) {
      headerIdx = i;
      break;
    }
  }

  if (headerIdx === -1) {
    for (let i = 0; i < lines.length; i++) {
      if ((lines[i].match(/\|/g) || []).length >= 3) {
        headerIdx = i;
        break;
      }
    }
  }

  if (headerIdx === -1) return [];

  const delimiter = "|";
  const parseRow = (line: string) =>
    line.split(delimiter).map((c) => c.trim()).filter((c) => c && c !== "---" && !c.match(/^-+$/));

  const headerCells = parseRow(lines[headerIdx]);
  if (headerCells.length < 2) return [];

  const findCol = (keywords: string[]) =>
    headerCells.findIndex((h) =>
      keywords.some((k) => h.toLowerCase().includes(k.toLowerCase()))
    );

  const idCol = findCol(["Generated Room Code", "Room Code", "Code", "ID"]);
  const nameCol = findCol(["Drawing Label", "Label", "Name"]);
  const levelCol = findCol(["Floor", "Level"]);
  const notesCol = findCol(["Notes", "Size", "Area"]);

  const dataLines = lines.slice(headerIdx + 1).filter((l) => {
    if (l.match(/^\|?\s*-+/)) return false;
    if (l.trim().toLowerCase().startsWith("rows:")) return false;
    if (l.trim().toLowerCase().startsWith("headers:")) return false;
    return true;
  });

  const instances: ParsedInstance[] = [];
  for (const line of dataLines) {
    const cells = parseRow(line);
    if (cells.length < 2) continue;
    if (cells.some((c) => c.toLowerCase().includes("none found"))) continue;
    if (cells.some((c) => c.toLowerCase().includes("no instances"))) continue;

    instances.push({
      id: idCol >= 0 && cells[idCol] ? cells[idCol] : cells[0] || "-",
      name: nameCol >= 0 && cells[nameCol] ? cells[nameCol] : cells[1] || "-",
      level: levelCol >= 0 && cells[levelCol] ? cells[levelCol] : "-",
      size: notesCol >= 0 && cells[notesCol] ? cells[notesCol] : "-",
    });
  }

  // Fallback 1: numbered entries like "1) " or "1. " (plain-text format from raster-image responses)
  if (instances.length === 0) {
    const numberedMatches = resultText.match(/^\s*\d+[.)]\s/gm) || [];
    if (numberedMatches.length > 0) {
      return numberedMatches.map((_, i) => ({ id: String(i + 1), name: "-", level: "-", size: "-" }));
    }
  }

  // Fallback 2: explicit "Total ... Found: N" or "Total: N" count in the text
  if (instances.length === 0) {
    const totalMatch = resultText.match(/total[^:]*:\s*(\d+)/i);
    if (totalMatch) {
      const n = parseInt(totalMatch[1], 10);
      if (n > 0) return Array.from({ length: n }, (_, i) => ({ id: String(i + 1), name: "-", level: "-", size: "-" }));
    }
  }

  return instances;
}

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// ---------------------------------------------------------------------------
// ExtractedTextBody — fetches from DB if not available locally
// ---------------------------------------------------------------------------
function ExtractedTextBody({ fileId, localText }: { fileId: string; localText?: string }) {
  const [text, setText] = useState<string | null>(localText ?? null);
  const [loading, setLoading] = useState(!localText);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (localText) { setText(localText); setLoading(false); return; }
    let cancelled = false;
    (async () => {
      // Try parent file first
      const { data: fileRow } = await supabase
        .from("analysis_request_files")
        .select("extracted_text")
        .eq("id", fileId)
        .single();
      let combined = (fileRow?.extracted_text as string) || "";

      // Fallback: concatenate per-sheet extracted_text (split files)
      if (!combined) {
        const { data: sheets } = await supabase
          .from("analysis_request_sheets")
          .select("page_index, extracted_text")
          .eq("parent_file_id", fileId)
          .order("page_index");
        if (sheets && sheets.length > 0) {
          combined = sheets
            .filter((s: any) => s.extracted_text)
            .map((s: any) => `--- Page ${s.page_index} ---\n${s.extracted_text}`)
            .join("\n\n");
        }
      }
      if (!cancelled) {
        setText(combined || null);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fileId, localText]);

  const handleCopy = useCallback(() => {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  if (loading) {
    return <div className="flex-1 flex items-center justify-center p-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="flex-1 flex flex-col gap-2 min-h-0">
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
      <div className="flex-1 overflow-auto border rounded-md p-4 bg-muted/30">
        <pre className="text-xs whitespace-pre-wrap break-words font-mono text-foreground">
          {text || "(no text extracted)"}
        </pre>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AnalysisSection
// ---------------------------------------------------------------------------

const ACTIVE_STATUSES = ["pending", "copying", "copied", "started", "processing"];

export function AnalysisSection({ requestId, files, projectId, sourceType, isWMSV, visibleAwpClasses, onAddFileUpload, onAddFileDrive, onAddFileProcore, onAddFileSharePoint }: AnalysisSectionProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const isInternal = (user?.email?.toLowerCase().endsWith("@riskclock.com")) ?? false;
  const queryClient = useQueryClient();

  // Canonical analysis-request state (status, phase, run id, ui label).
  // Prefer the shared instance from a surrounding provider so the badge in
  // WMSVProjectDetail and this section share one local-pending mask.
  const sharedRequestState = useSharedAnalysisRequestState();
  const localRequestState = useAnalysisRequestState(sharedRequestState ? null : requestId);
  const requestState = sharedRequestState ?? localRequestState;

  // ---- New state architecture ----
  const [analyzingClasses, setAnalyzingClasses] = useState<Set<string>>(new Set());
  const [classFileStatuses, setClassFileStatuses] = useState<Record<string, Record<string, string>>>({});
  const [triageModel, setTriageModel] = useState<string>("gpt-5-nano");
  const [analyzeModel, setAnalyzeModel] = useState<string>("gpt-5-mini");
  const [engineVersion, setEngineVersion] = useState<string>("7.2");
  const abortControllers = useRef<Record<string, AbortController>>({});
  const [rawResultModal, setRawResultModal] = useState<{
    fileName: string;
    awpClassName: string;
    resultText: string;
    instanceCount: number;
    sourceFile?: AnalysisFile;
  } | null>(null);

  // ---- Triage state ----
  const [triageResults, setTriageResults] = useState<Map<string, TriageResult>>(new Map());
  const [triageRunning, setTriageRunning] = useState(false);
  const [triagingClasses, setTriagingClasses] = useState<Set<string>>(new Set());
  const [triageTokens, setTriageTokens] = useState(0);
  const [analyzeTokens, setAnalyzeTokens] = useState(0);
  const analyzeTokensRef = useRef(0);
  const [uploadingFileIds, setUploadingFileIds] = useState<Set<string>>(new Set());
  const [analyzeV2Running, setAnalyzeV2Running] = useState(false);
  const analyzeRunSyncRef = useRef<"idle" | "starting" | "running" | "stopping">("idle");
  const prevPipelinePhaseRef = useRef<string | null>(null);
  const [triagePhase, setTriagePhase] = useState<"extract" | "score" | null>(null);
  const [summaryGroupBy, setSummaryGroupBy] = useState<"awp" | "floor">("awp");
  const [triageProgress, setTriageProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [extractingFileIds, setExtractingFileIds] = useState<Set<string>>(new Set());
  const [extractedFileIds, setExtractedFileIds] = useState<Set<string>>(new Set());
  const [extractedTexts, setExtractedTexts] = useState<Map<string, string>>(new Map());
  const triageQueueRef = useRef<Array<{ file: AnalysisFile; prompt?: AWPPrompt; action: "extract" | "triage" }>>([]);
  const triageTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---- Manual triage overrides ----
  const [triageOverrides, setTriageOverrides] = useState<Map<string, "include" | "exclude">>(new Map());
  const [buyCreditsOpen, setBuyCreditsOpen] = useState(false);
  const [buyCreditsReason, setBuyCreditsReason] = useState<string>("You're out of scan credits. Buy more to start a triage.");
  const { balance: creditsBalance } = useCredits();
  const inFlightCountRef = useRef(0);
  const MAX_CONCURRENT_TRIAGE = 10;
  const MAX_CONCURRENT_TRIAGE_SINGLE = 5;

  // ---- Extract Context state ----
  const [extractRunning, setExtractRunning] = useState(false);
  const [extractStopping, setExtractStopping] = useState(false);
  const [extractProgress, setExtractProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const extractQueueRef = useRef<Array<{ file: AnalysisFile; action: "extract" }>>([]);
  const extractTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---- Unchanged state ----
  const [summarizedInstances, setSummarizedInstances] = useState<Record<string, SummarizedInstance[]>>({});
  const [summarizing, setSummarizing] = useState<Record<string, boolean>>({});
  const [addingToProject, setAddingToProject] = useState<Record<string, boolean>>({});
  const [addedToProject, setAddedToProject] = useState<Record<string, boolean>>({});
  const [summaryRunning, setSummaryRunning] = useState(false);
  const summaryAbortRef = useRef(false);
  const [selectedInstance, setSelectedInstance] = useState<{
    instance: SummarizedInstance;
    awpClassName: string;
  } | null>(null);
  const [previewFile, setPreviewFile] = useState<AnalysisFile | null>(null);
  const [extractedTextFile, setExtractedTextFile] = useState<AnalysisFile | null>(null);

  // ---- Column enable/disable state ----
  const [disabledColumns, setDisabledColumns] = useState<Set<string>>(new Set());
  const disabledColumnsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    disabledColumnsRef.current = disabledColumns;
  }, [disabledColumns]);

  // ---- Queries ----
  const { data: prompts, isLoading: promptsLoading } = useQuery({
    queryKey: ["awp-prompts-linked"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("awp_class_prompts")
        .select("*")
        .not("drive_file_id", "is", null)
        .order("awp_class_name");
      if (error) throw error;
      return data as AWPPrompt[];
    },
  });

  // Fetch project characteristics for filtering AWP columns
  const { data: projectInfo } = useQuery({
    queryKey: ["project-info-for-analysis", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("project_type, project_data")
        .eq("id", projectId)
        .single();
      if (error) throw error;
      return data as { project_type: string | null; project_data: Record<string, any> | null };
    },
    enabled: !!projectId,
  });

  const currentRunId = requestState.runId;

  const { data: results } = useQuery({
    queryKey: ["analysis-results", requestId, currentRunId],
    queryFn: async () => {
      let q = supabase
        .from("analysis_results")
        .select("*")
        .eq("analysis_request_id", requestId)
        .order("created_at");
      if (currentRunId) q = q.eq("analysis_run_id", currentRunId);
      const { data, error } = await q;
      if (error) throw error;
      return data as AnalysisResult[];
    },
    refetchInterval: 5000,
  });

  // Fetch existing triage results
  const { data: triageData } = useQuery({
    queryKey: ["triage-results", requestId, currentRunId],
    queryFn: async () => {
      let q = supabase
        .from("analysis_triage_results")
        .select("file_id, awp_class_name, status, score, reason, error_message, instances")
        .eq("analysis_request_id", requestId);
      if (currentRunId) q = q.eq("analysis_run_id", currentRunId);
      const { data, error } = await q;
      if (error) throw error;
      return data as TriageResult[];
    },
    refetchInterval: (() => {
      const s = queryClient.getQueryData<any>(["analysis-request-meta", requestId])?.status;
      return ACTIVE_STATUSES.includes(s) ? 5000 : false;
    })() as number | false,
  });

  // Triage progress breakdown: distinguish pages truly triaged by the AI from
  // pages auto-completed via the bulk short-circuit ("sibling already scored
  // 100%"). Used by the chip + tooltip so the count never misleadingly jumps.
  const { data: triageBreakdown } = useQuery({
    queryKey: ["triage-progress-breakdown", requestId, currentRunId],
    queryFn: async () => {
      let q = supabase
        .from("analysis_pipeline_jobs")
        .select("status, error_message")
        .eq("analysis_request_id", requestId)
        .eq("job_kind", "triage");
      if (currentRunId) q = q.eq("analysis_run_id", currentRunId);
      const { data, error } = await q;
      if (error) throw error;
      const rows = (data ?? []) as Array<{ status: string; error_message: string | null }>;
      let triaged = 0;
      let shortCircuited = 0;
      for (const r of rows) {
        if (r.status !== "complete") continue;
        if ((r.error_message || "").startsWith("Short-circuited")) shortCircuited += 1;
        else triaged += 1;
      }
      return { triaged, shortCircuited, total: rows.length };
    },
    refetchInterval: (() => {
      const s = queryClient.getQueryData<any>(["analysis-request-meta", requestId])?.status;
      return ACTIVE_STATUSES.includes(s) ? 5000 : false;
    })() as number | false,
    enabled: !!requestId,
  });

  // Hydrate triage results into map. In sheet-normalized mode there is one
  // triage row per (file, class, sheet) — we collapse to the MAX score per
  // (file, class) so a single high-scoring page keeps the cell highlighted
  // even if other pages of the same file score low. The MAX represents the
  // strongest evidence that the file is worth a deep Phase-3 analysis.
  useEffect(() => {
    if (!triageData) return;
    const map = new Map<string, TriageResult>();
    for (const r of triageData) {
      const key = `${r.file_id}_${r.awp_class_name}`;
      const existing = map.get(key);
      const existingScore = existing?.score ?? -1;
      const newScore = r.score ?? -1;
      // Prefer 'complete' rows over pending/queued/processing; among completes
      // prefer the higher score; preserve highest 'instances' as a tiebreaker.
      const existingRank = existing?.status === "complete" ? 1 : 0;
      const newRank = r.status === "complete" ? 1 : 0;
      if (
        !existing ||
        newRank > existingRank ||
        (newRank === existingRank && newScore > existingScore)
      ) {
        map.set(key, r);
      }
    }
    setTriageResults(map);
  }, [triageData]);

  // Fetch triage overrides from DB
  const { data: overridesData } = useQuery({
    queryKey: ["triage-overrides", requestId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("analysis_triage_overrides" as any)
        .select("file_id, awp_class_name, override_type")
        .eq("analysis_request_id", requestId);
      if (error) throw error;
      return (data as unknown as Array<{ file_id: string; awp_class_name: string; override_type: string }>);
    },
  });

  // Hydrate overrides into map
  useEffect(() => {
    if (!overridesData) return;
    const map = new Map<string, "include" | "exclude">();
    for (const r of overridesData) {
      map.set(`${r.file_id}_${r.awp_class_name}`, r.override_type as "include" | "exclude");
    }
    setTriageOverrides(map);
  }, [overridesData]);

  // Toggle triage override (3-state: default → override → back to default)
  const handleTriageCellClick = async (fileId: string, awpClassName: string, score: number) => {
    // Lock overrides during deep analysis phase — cells become non-interactive
    const currentPhase = (queryClient.getQueryData(["analysis-request-meta", requestId]) as any)?.pipeline_phase;
    if (currentPhase === "analyzing") return;
    const key = `${fileId}_${awpClassName}`;
    const currentOverride = triageOverrides.get(key);

    if (currentOverride) {
      // Has override → remove it (back to default)
      setTriageOverrides((prev) => { const next = new Map(prev); next.delete(key); return next; });
      await supabase.from("analysis_triage_overrides" as any).delete().eq("analysis_request_id", requestId).eq("file_id", fileId).eq("awp_class_name", awpClassName);
    } else {
      // No override → toggle based on auto state
      const newType = score >= 50 ? "exclude" : "include";
      setTriageOverrides((prev) => { const next = new Map(prev); next.set(key, newType as "include" | "exclude"); return next; });
      await supabase.from("analysis_triage_overrides" as any).upsert({
        analysis_request_id: requestId,
        file_id: fileId,
        awp_class_name: awpClassName,
        override_type: newType,
      } as any, { onConflict: "analysis_request_id,file_id,awp_class_name" });
    }
  };

  // Fetch persisted model selections, token count, and pipeline progress
  const { data: requestMeta } = useQuery({
    queryKey: ["analysis-request-meta", requestId],
    queryFn: async () => {
      const { data } = await supabase
        .from("analysis_requests")
        .select("status, summary_data, triage_tokens_used, analyze_tokens_used, triage_model, analyze_model, disabled_awp_classes, pipeline_phase, pipeline_progress_done, pipeline_progress_total, pipeline_stop_requested, error_message")
        .eq("id", requestId)
        .single();
      return data;
    },
    refetchInterval: (query: any) => {
      const s = query?.state?.data?.status;
      const phase = query?.state?.data?.pipeline_phase;
      // Keep polling while active, or while pipeline is still running a background phase
      // (e.g. status="complete" but pipeline_phase="summarizing")
      if (ACTIVE_STATUSES.includes(s)) return 5000;
      if (phase) return 5000;
      return false;
    },
  });
  const [disabledDefaultsApplied, setDisabledDefaultsApplied] = useState(false);
  useEffect(() => {
    if (!requestMeta) return;
    if (requestMeta.triage_model) setTriageModel(requestMeta.triage_model as string);
    if (requestMeta.analyze_model) setAnalyzeModel(requestMeta.analyze_model as string);
    if (requestMeta.triage_tokens_used) setTriageTokens(requestMeta.triage_tokens_used as number);
    if ((requestMeta as any).analyze_tokens_used) {
      const at = (requestMeta as any).analyze_tokens_used as number;
      setAnalyzeTokens(at);
      analyzeTokensRef.current = at;
    }
    const disabled = (requestMeta as any).disabled_awp_classes as string[] | null;
    // Treat empty array same as null — apply DEFAULT_DISABLED_AWP later.
    // Only honor a persisted non-empty selection as the user's explicit choice.
    if (Array.isArray(disabled) && disabled.length > 0) {
      setDisabledColumns(new Set(disabled));
      setDisabledDefaultsApplied(true);
    }
  }, [requestMeta]);

  // (Default-disabled AWP classes are applied below, after sortedPrompts is defined.)

  // Hydrate analyzeV2Running from canonical request state.
  // Stale-row protection lives inside useAnalysisRequestState (run-id mask).
  const hasTriggeredResumeRef = useRef(false);
  useEffect(() => {
    const isRunning = requestState.isRunning;
    const isTerminal = requestState.isTerminal;
    if (isRunning) {
      analyzeRunSyncRef.current = "running";
      if (!analyzeV2Running) setAnalyzeV2Running(true);
    } else if (isTerminal || requestState.uiState === "ready") {
      analyzeRunSyncRef.current = "idle";
      if (analyzeV2Running) setAnalyzeV2Running(false);
      setAnalyzeV2Stopping(false);
      setAnalyzingClasses((prev) => (prev.size ? new Set() : prev));
      setClassFileStatuses((prev) => (Object.keys(prev).length ? {} : prev));
    }
  }, [requestState.isRunning, requestState.isTerminal, requestState.uiState, analyzeV2Running]);

  // ---- Realtime subscriptions ----
  useEffect(() => {
    if (!requestId) return;
    const channel: RealtimeChannel = supabase
      .channel(`analysis-rt-${requestId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "analysis_requests", filter: `id=eq.${requestId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ["analysis-request-meta", requestId] });
          queryClient.invalidateQueries({ queryKey: ["triage-results", requestId] });
          queryClient.invalidateQueries({ queryKey: ["analysis-results", requestId] });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "analysis_triage_results", filter: `analysis_request_id=eq.${requestId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ["triage-results", requestId] });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "analysis_results", filter: `analysis_request_id=eq.${requestId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ["analysis-results", requestId] });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "analysis_request_files", filter: `analysis_request_id=eq.${requestId}` },
        () => {
          supabase
            .from("analysis_request_files")
            .select("id")
            .eq("analysis_request_id", requestId)
            .not("extracted_text", "is", null)
            .then(({ data }) => {
              if (data) setExtractedFileIds(new Set(data.map((f: any) => f.id)));
            });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [requestId, queryClient]);

  // Load extracted file IDs on mount so "Processed" badges appear immediately
  useEffect(() => {
    if (!requestId || copiedFiles.length === 0) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("analysis_request_files")
        .select("id")
        .eq("analysis_request_id", requestId)
        .not("extracted_text", "is", null);
      if (!cancelled && data) {
        setExtractedFileIds(new Set(data.map((f: any) => f.id)));
      }
    })();
    return () => { cancelled = true; };
  }, [requestId, files.length]);

  // ---- Sheet-based extraction tracking (sheet-normalized mode) ----
  // For each parent file we track how many sheets are still pending vs total.
  // Drives:
  //   - spinner stays visible while ANY sheet of the file is not yet extracted
  //   - "Processed" badge appears only once ALL sheets of the file are extracted
  const { data: sheetStatusData } = useQuery({
    queryKey: ["analysis-sheet-status", requestId],
    enabled: !!requestId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("analysis_request_sheets")
        .select("parent_file_id, extract_status")
        .eq("analysis_request_id", requestId);
      if (error) throw error;
      return (data ?? []) as Array<{ parent_file_id: string; extract_status: string }>;
    },
    refetchInterval: (query: any) => {
      const phase = (queryClient.getQueryData(["analysis-request-meta", requestId]) as any)?.pipeline_phase;
      if (phase === "extracting" || phase === "splitting") return 3000;
      return false;
    },
  });

  // Realtime invalidation for sheet status
  useEffect(() => {
    if (!requestId) return;
    const channel: RealtimeChannel = supabase
      .channel(`analysis-sheets-${requestId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "analysis_request_sheets", filter: `analysis_request_id=eq.${requestId}` },
        () => queryClient.invalidateQueries({ queryKey: ["analysis-sheet-status", requestId] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [requestId, queryClient]);

  // Map<fileId, { pending: number; total: number }>
  const sheetProgressByFile = useMemo(() => {
    const m = new Map<string, { pending: number; total: number }>();
    for (const s of sheetStatusData ?? []) {
      const cur = m.get(s.parent_file_id) ?? { pending: 0, total: 0 };
      cur.total += 1;
      if (s.extract_status !== "extracted" && s.extract_status !== "skipped") {
        cur.pending += 1;
      }
      m.set(s.parent_file_id, cur);
    }
    return m;
  }, [sheetStatusData]);

  // Refresh extraction badges on every pipeline phase transition (not only out of "extracting").
  // This ensures non-sheet-mode runs get the Processed badge once extract completes.
  useEffect(() => {
    const currentPhase = (requestMeta as any)?.pipeline_phase as string | null;
    const prev = prevPipelinePhaseRef.current;
    prevPipelinePhaseRef.current = currentPhase;

    if (prev !== currentPhase && requestId) {
      supabase
        .from("analysis_request_files")
        .select("id")
        .eq("analysis_request_id", requestId)
        .not("extracted_text", "is", null)
        .then(({ data }) => {
          if (data) setExtractedFileIds(new Set(data.map((f: any) => f.id)));
        });
    }
  }, [(requestMeta as any)?.pipeline_phase, requestId]);

  // Realtime: keep extractedFileIds fresh as parent files get extracted_text written.
  useEffect(() => {
    if (!requestId) return;
    const channel: RealtimeChannel = supabase
      .channel(`analysis-files-extracted-${requestId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "analysis_request_files", filter: `analysis_request_id=eq.${requestId}` },
        (payload: any) => {
          const row = payload?.new;
          if (row?.id && row?.extracted_text) {
            setExtractedFileIds((prev) => {
              if (prev.has(row.id)) return prev;
              const next = new Set(prev);
              next.add(row.id);
              return next;
            });
          }
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [requestId]);

  const savedSummaryData = useMemo(() => {
    return (requestMeta?.summary_data as unknown as Record<string, SummarizedInstance[]>) || {};
  }, [requestMeta]);

  const { data: awpClasses } = useQuery({
    queryKey: ["awp-classes-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("awp_classes")
        .select("id, name, category, id_prefix");
      if (error) throw error;
      return data;
    },
  });

  // ---- Source-of-truth AWP order + prefix from source tables ----
  const { data: awpOrderData } = useQuery({
    queryKey: ["awp-source-order"],
    queryFn: async () => {
      const [a, w, p] = await Promise.all([
        supabase.from("critical_assets").select("name, id_prefix, display_order").eq("is_active", true).order("display_order"),
        supabase.from("water_systems").select("name, id_prefix, display_order").eq("is_active", true).order("display_order"),
        supabase.from("processes").select("name, id_prefix, display_order").eq("is_active", true).order("display_order"),
      ]);
      return [
        ...(a.data || []).map((x, i) => ({ name: x.name, id_prefix: x.id_prefix, globalOrder: i })),
        ...(w.data || []).map((x, i) => ({ name: x.name, id_prefix: x.id_prefix, globalOrder: 1000 + i })),
        ...(p.data || []).map((x, i) => ({ name: x.name, id_prefix: x.id_prefix, globalOrder: 2000 + i })),
      ];
    },
    staleTime: 1000 * 60 * 30,
  });

  const copiedFiles = files.filter((f) => f.copy_status === "copied" && f.storage_path);

  // Auto-resume: when we hydrate as "processing" but have no active scheduler,
  // rebuild the work queue from incomplete cells and restart.
  useEffect(() => {
    if (!analyzeV2Running) return;
    if (hasTriggeredResumeRef.current) return;
    if (analyzeV2TimerRef.current !== null) return;
    if (analyzeV2InFlightRef.current > 0) return;
    if (analyzeV2QueueRef.current.length > 0) return;
    if (!prompts || prompts.length === 0) return;
    if (copiedFiles.length === 0) return;
    if (!results) return;

    hasTriggeredResumeRef.current = true;
    console.log("[V2] Auto-resuming analysis from incomplete state");

    (async () => {
      try {
        const enabledPrompts = sortedPrompts.filter(
          (p) => !disabledColumnsRef.current.has(p.awp_class_name) && (p.drive_file_id || p.prompt_content)
        );
        if (enabledPrompts.length === 0) {
          analyzeRunSyncRef.current = "idle";
          setAnalyzeV2Running(false);
          await supabase.from("analysis_requests").update({ status: "complete" }).eq("id", requestId);
          return;
        }

        const processedFiles = copiedFiles.filter((f) => extractedFileIds.has(f.id));
        const promptByClass = new Map<string, AWPPrompt>();
        for (const p of enabledPrompts) promptByClass.set(p.awp_class_name, p);

        const completedCells = new Set<string>();
        for (const r of results) {
          if (r.status === "complete" || r.status === "failed") {
            completedCells.add(`${r.file_id}_${r.awp_class_name}`);
          }
        }

        interface WorkItem {
          fileId: string;
          awpClassName: string;
          prompt: AWPPrompt;
          fileName: string;
          needsUpload: boolean;
        }
        const workQueue: WorkItem[] = [];
        const fileOpenaiIds = new Map<string, string>();

        for (const file of processedFiles) {
          const eligibleClasses: string[] = [];
          for (const prompt of enabledPrompts) {
            const key = `${file.id}_${prompt.awp_class_name}`;
            const override = triageOverrides.get(key);
            const triage = triageResults.get(key);
            if (override === "exclude") continue;
            if (override === "include") { eligibleClasses.push(prompt.awp_class_name); continue; }
            if (triage?.status === "complete" && triage.score !== null && triage.score >= 50) {
              eligibleClasses.push(prompt.awp_class_name);
            }
          }

          let cachedOpenaiFileId: string | null = null;
          const { data: fileRow } = await supabase
            .from("analysis_request_files")
            .select("openai_file_id, openai_file_uploaded_at, openai_file_status")
            .eq("id", file.id)
            .single();

          if (fileRow?.openai_file_id && fileRow.openai_file_status !== "invalid") {
            const uploadedAt = fileRow.openai_file_uploaded_at ? new Date(fileRow.openai_file_uploaded_at as string).getTime() : 0;
            const LOCAL_TTL = 71 * 60 * 60 * 1000 + 45 * 60 * 1000;
            if (Date.now() - uploadedAt < LOCAL_TTL) {
              cachedOpenaiFileId = fileRow.openai_file_id as string;
              fileOpenaiIds.set(file.id, cachedOpenaiFileId);
            }
          }

          const hasCache = !!cachedOpenaiFileId;
          let firstUncachedQueued = false;
          for (const cn of eligibleClasses) {
            if (completedCells.has(`${file.id}_${cn}`)) continue;
            const prompt = promptByClass.get(cn);
            if (!prompt) continue;
            const needsUpload = !hasCache && !firstUncachedQueued;
            if (needsUpload) firstUncachedQueued = true;
            workQueue.push({ fileId: file.id, awpClassName: cn, prompt, fileName: file.name, needsUpload });
          }
        }

        if (workQueue.length === 0) {
          console.log("[V2] No incomplete cells found, marking complete");
          analyzeRunSyncRef.current = "idle";
          setAnalyzeV2Running(false);
          setAnalyzingClasses(new Set());
          await supabase.from("analysis_requests").update({ status: "complete" }).eq("id", requestId);
          return;
        }

        console.log(`[V2] Resuming with ${workQueue.length} incomplete cells`);
        const resumeClasses = new Set(workQueue.map((w) => w.awpClassName));
        setAnalyzingClasses(resumeClasses);
        analyzeRunSyncRef.current = "running";

        // NOTE: inFlight is incremented BEFORE calling executeItem (at dequeue site)
        const executeItem = async (item: WorkItem) => {
          try {
            const { data: sd } = await supabase.auth.getSession();
            const tk = sd.session?.access_token;

            setClassFileStatuses((prev) => ({
              ...prev,
              [item.awpClassName]: { ...(prev[item.awpClassName] || {}), [item.fileId]: "processing" },
            }));

            const promptContent = await resolvePromptContent(item.prompt, tk ?? undefined);
            if (!promptContent) {
              setClassFileStatuses((prev) => ({
                ...prev,
                [item.awpClassName]: { ...(prev[item.awpClassName] || {}), [item.fileId]: "failed" },
              }));
              return;
            }

            let openaiFileId = fileOpenaiIds.get(item.fileId) || null;

            if (!openaiFileId && item.needsUpload) {
              setUploadingFileIds((prev) => { const n = new Set(prev); n.add(item.fileId); return n; });
              const uploadResponse = await fetch(
                `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-drawings`,
                {
                  method: "POST",
                  headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" },
                  body: JSON.stringify({ analysisRequestId: requestId, fileId: item.fileId, awpClassName: item.awpClassName, promptContent, model: analyzeModel }),
                }
              );
              setUploadingFileIds((prev) => { const n = new Set(prev); n.delete(item.fileId); return n; });

              if (uploadResponse.ok) {
                const data = await uploadResponse.json();
                openaiFileId = data.openaiFileId || null;
                if (openaiFileId) fileOpenaiIds.set(item.fileId, openaiFileId);
                if (data.usage?.total_tokens) {
                  analyzeTokensRef.current += data.usage.total_tokens;
                  setAnalyzeTokens(analyzeTokensRef.current);
                  supabase.from("analysis_requests").update({ analyze_tokens_used: analyzeTokensRef.current } as any).eq("id", requestId);
                }
                setClassFileStatuses((prev) => ({
                  ...prev,
                  [item.awpClassName]: { ...(prev[item.awpClassName] || {}), [item.fileId]: "complete" },
                }));
                await queryClient.invalidateQueries({ queryKey: ["analysis-results", requestId] });
              } else {
                setClassFileStatuses((prev) => ({
                  ...prev,
                  [item.awpClassName]: { ...(prev[item.awpClassName] || {}), [item.fileId]: "failed" },
                }));
              }
              return;
            }

            if (!openaiFileId) {
              for (let attempt = 0; attempt < 120; attempt++) {
                openaiFileId = fileOpenaiIds.get(item.fileId) || null;
                if (openaiFileId) break;
                await new Promise((r) => setTimeout(r, 1000));
              }
            }

            if (!openaiFileId) {
              setClassFileStatuses((prev) => ({
                ...prev,
                [item.awpClassName]: { ...(prev[item.awpClassName] || {}), [item.fileId]: "failed" },
              }));
              return;
            }

            const analyzeResponse = await fetch(
              `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-drawings`,
              {
                method: "POST",
                headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" },
                body: JSON.stringify({ analysisRequestId: requestId, fileId: item.fileId, awpClassName: item.awpClassName, promptContent, model: analyzeModel, openaiFileId }),
              }
            );

            setClassFileStatuses((prev) => ({
              ...prev,
              [item.awpClassName]: { ...(prev[item.awpClassName] || {}), [item.fileId]: analyzeResponse.ok ? "complete" : "failed" },
            }));

            if (analyzeResponse.ok) {
              const data = await analyzeResponse.json();
              if (data.usage?.total_tokens) {
                analyzeTokensRef.current += data.usage.total_tokens;
                setAnalyzeTokens(analyzeTokensRef.current);
                supabase.from("analysis_requests").update({ analyze_tokens_used: analyzeTokensRef.current } as any).eq("id", requestId);
              }
              await queryClient.invalidateQueries({ queryKey: ["analysis-results", requestId] });
            }
          } catch (e) {
            setClassFileStatuses((prev) => ({
              ...prev,
              [item.awpClassName]: { ...(prev[item.awpClassName] || {}), [item.fileId]: "failed" },
            }));
          } finally {
            analyzeV2InFlightRef.current--;
            setAnalyzeV2Progress((prev) => ({ ...prev, done: prev.done + 1 }));
          }
        };

        analyzeV2QueueRef.current = workQueue;
        analyzeV2InFlightRef.current = 0;
        completionFiredRef.current = false;
        setAnalyzeV2Progress({ done: 0, total: workQueue.length });

        const dequeueItems = () => {
          const queue = analyzeV2QueueRef.current;
          const activeFileIds = new Set<string>();
          Object.values(classFileStatuses).forEach((fileMap) => {
            Object.entries(fileMap).forEach(([fileId, status]) => {
              if (status === "processing") activeFileIds.add(fileId);
            });
          });

          const currentFileId = activeFileIds.size > 0 ? Array.from(activeFileIds)[0] : queue[0]?.fileId;
          if (!currentFileId) return;

          while (analyzeV2InFlightRef.current < MAX_CONCURRENT_ANALYZE) {
            const idx = queue.findIndex((q: any) => q.fileId === currentFileId);
            if (idx === -1) break;
            const item = queue[idx];
            analyzeV2InFlightRef.current++;
            queue.splice(idx, 1);
            executeItem(item as any);
          }
        };

        analyzeV2TimerRef.current = setInterval(() => {
          if (analyzeV2QueueRef.current.length === 0 && analyzeV2InFlightRef.current <= 0) {
            if (analyzeV2TimerRef.current) { clearInterval(analyzeV2TimerRef.current); analyzeV2TimerRef.current = null; }
            if (completionFiredRef.current) return;
            completionFiredRef.current = true;
            (async () => {
              await queryClient.invalidateQueries({ queryKey: ["analysis-results", requestId] });
              analyzeRunSyncRef.current = "idle";
              setAnalyzeV2Running(false);
              setAnalyzingClasses(new Set());
              await supabase.from("analysis_requests").update({ status: "complete" }).eq("id", requestId);
              toast({ title: "Analysis Complete", description: "All files analyzed." });
              // Auto-summarize removed — user triggers manually
            })();
            return;
          }
          dequeueItems();
        }, 1000);

        dequeueItems();
      } catch (e) {
        console.error("[V2] Resume error:", e);
        analyzeRunSyncRef.current = "idle";
        setAnalyzeV2Running(false);
        setAnalyzingClasses(new Set());
      }
    })();
  }, [analyzeV2Running, prompts, copiedFiles]);

  // id_prefix lookup from awp_classes (fallback)
  const idPrefixMap = useMemo(
    () => Object.fromEntries((awpClasses || []).map((c) => [c.name, c.id_prefix])),
    [awpClasses]
  );

  // Source-of-truth prefix map (preferred over awp_classes)
  const sourcePrefixMap = useMemo(
    () => Object.fromEntries((awpOrderData || []).filter(x => x.id_prefix).map((x) => [x.name, x.id_prefix!])),
    [awpOrderData]
  );

  // Global order map for sorting
  const globalOrderMap = useMemo(
    () => Object.fromEntries((awpOrderData || []).map((x) => [x.name, x.globalOrder])),
    [awpOrderData]
  );

  // Helper: check if an AWP class should appear in the analysis queue
  const isDrawingDetectable = useCallback((prompt: AWPPrompt): boolean => {
    if (prompt.detection_method === 'always') return false;
    if (prompt.detection_method === 'conditional') {
      const rule = prompt.condition_rule;
      if (!rule) return false;
      const field = rule.field as string;
      if (rule.contains) {
        // Check if project's structural_types array contains the value
        const structuralTypes = projectInfo?.project_data?.structural_types as string[] | undefined;
        return Array.isArray(structuralTypes) && structuralTypes.some(
          (t: string) => t.toLowerCase().includes(rule.contains.toLowerCase())
        );
      }
      if (rule.in) {
        // Check if project_type is in the allowed list
        const projectType = field === 'project_type' ? projectInfo?.project_type : null;
        return projectType ? (rule.in as string[]).includes(projectType.toLowerCase()) : false;
      }
      return false;
    }
    return true; // 'drawing' detection method
  }, [projectInfo]);

  // Sorted prompts to match Configuration page order — filtered to drawing-detectable only
  const sortedPromptsBase = useMemo(() => {
    if (!prompts) return [];
    return [...prompts]
      .filter(p => isDrawingDetectable(p))
      .sort((a, b) => {
        const oa = globalOrderMap[a.awp_class_name] ?? 9999;
        const ob = globalOrderMap[b.awp_class_name] ?? 9999;
        return oa - ob;
      });
  }, [prompts, globalOrderMap, isDrawingDetectable]);

  // For WMSV: further filter to only visible AWP classes
  const sortedPrompts = useMemo(() => {
    // undefined = no filtering (non-WMSV), empty array = no controls enabled (hide all)
    if (visibleAwpClasses === undefined) return sortedPromptsBase;
    if (visibleAwpClasses.length === 0) return [];
    const allowed = new Set(visibleAwpClasses);
    return sortedPromptsBase.filter(p => allowed.has(p.awp_class_name));
  }, [sortedPromptsBase, visibleAwpClasses]);

  // Apply default disabled AWP classes (ERS, MRS, TWR, FS, SPSDD, DHW, HYD) when nothing has been persisted yet.
  const DEFAULT_DISABLED_AWP = useMemo(
    () => new Set([
      "Mechanical Riser",
      "Electrical Riser",
      "Temporary Water Run",
      "Fire Suppression System",
      "Sump Pit, Storm Drain & Drainage",
      "Domestic Hot Water",
      "Hydronics",
    ]),
    []
  );
  useEffect(() => {
    if (disabledDefaultsApplied) return;
    if (!requestMeta) return;
    const persisted = (requestMeta as any).disabled_awp_classes as string[] | null;
    // Skip defaults only when user has an explicit non-empty selection persisted.
    if (Array.isArray(persisted) && persisted.length > 0) return;
    if (!sortedPrompts || sortedPrompts.length === 0) return;
    const namesPresent = sortedPrompts
      .map((p) => p.awp_class_name)
      .filter((n) => DEFAULT_DISABLED_AWP.has(n));
    if (namesPresent.length === 0) {
      setDisabledDefaultsApplied(true);
      return;
    }
    setDisabledColumns(new Set(namesPresent));
    setDisabledDefaultsApplied(true);
    supabase
      .from("analysis_requests")
      .update({ disabled_awp_classes: namesPresent } as any)
      .eq("id", requestId)
      .then(() => {});
  }, [disabledDefaultsApplied, requestMeta, sortedPrompts, DEFAULT_DISABLED_AWP, requestId]);

  // ---- WMSV chained analysis state ----
  const [wmsvPhase, setWmsvPhase] = useState<"idle" | "extracting" | "triaging" | "analyzing">("idle");
  const wmsvAbortRef = useRef(false);

  // Helper to start the backend pipeline
  const startPipeline = async (phaseOverride?: string) => {
    // NOTE: Credit gating is handled in handleWmsvStartAnalysis (the user-facing
    // Start Analysis button) — 1 credit per file in the analysis request.
    // Internal restart-from-* menu items are dev/debug only and do not charge.

    // Generate a client-side run id and mark Start as locally pending so the
    // canonical state hook masks any stale rows from a previous run until the
    // backend writes the new analysis_run_id.
    const localRunId = (typeof crypto !== "undefined" && "randomUUID" in crypto)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;
    requestState.beginLocalStart(localRunId);
    analyzeRunSyncRef.current = "starting";
    setAnalyzeV2Running(true);

    // Phase-aware clearing for visual feedback
    if (phaseOverride === "analyze") {
      // Only clear analysis results; keep extracted text, triage results, and overrides
      queryClient.setQueryData(["analysis-results", requestId], []);
    } else if (phaseOverride === "triage") {
      // Clear triage + analysis results; keep extracted file IDs
      setTriageResults(new Map());
      setTriageOverrides(new Map());
      queryClient.setQueryData(["analysis-results", requestId], []);
      queryClient.setQueryData(["triage-results", requestId], []);
    } else {
      // Full clear
      setExtractedFileIds(new Set());
      setTriageResults(new Map());
      setTriageOverrides(new Map());
      queryClient.setQueryData(["analysis-results", requestId], []);
      queryClient.setQueryData(["triage-results", requestId], []);
    }

    try {
      // Compute enabledAwpClasses from live state (not the ref, which lags by one render)
      const enabledAwpClasses = sortedPrompts
        .filter(p => !disabledColumns.has(p.awp_class_name))
        .map(p => p.awp_class_name);

      const response = await supabase.functions.invoke("run-analysis-pipeline", {
        body: {
          analysisRequestId: requestId,
          enabledAwpClasses,
          triageModel,
          analyzeModel,
          phaseOverride,
        },
      });

      if (response.error) {
        throw new Error(response.error.message);
      }
      // The hook auto-clears the local pending mask once the DB row carries
      // any non-null analysis_run_id from this start (see hook's auto-clear).
      // We can't know the server's run id here, so just leave the mask in
      // place — it will fall away on the next row update.
    } catch (e) {
      // Rollback local pending state
      requestState.clearLocalStart();
      analyzeRunSyncRef.current = "idle";
      setAnalyzeV2Running(false);
      toast({
        title: "Failed to start analysis",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const handleWmsvStartAnalysis = async () => {
    const required = copiedFiles.length;
    if (required === 0) return;

    // Insufficient credits — open Buy Credits modal with explanation, do NOT start.
    if (required > creditsBalance) {
      setBuyCreditsReason(
        `This analysis needs ${required} credit${required === 1 ? "" : "s"} (1 per file) but you only have ${creditsBalance}. Buy more credits to continue.`,
      );
      setBuyCreditsOpen(true);
      return;
    }

    // Consume credits up-front (1 per file). Atomic, idempotent per call.
    const userId = (await supabase.auth.getUser()).data.user?.id;
    const { data: consumeData, error: consumeError } = await supabase.rpc(
      "consume_credits" as any,
      { p_user_id: userId, p_amount: required, p_analysis_request_id: requestId },
    );
    if (consumeError) {
      toast({
        title: "Couldn't check credit balance",
        description: (consumeError as any)?.message ?? "Unknown error",
        variant: "destructive",
      });
      return;
    }
    const result = consumeData as { success: boolean; balance: number; reason?: string } | null;
    if (!result?.success) {
      setBuyCreditsReason(
        `This analysis needs ${required} credit${required === 1 ? "" : "s"} but you only have ${result?.balance ?? 0}. Buy more credits to continue.`,
      );
      setBuyCreditsOpen(true);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["credits-balance"] });

    await startPipeline();
  };


  const handleWmsvStop = async () => {
    setAnalyzeV2Stopping(true);
    try {
      requestState.clearLocalStart();
      queryClient.setQueryData(["analysis-request-row", requestId], (old: any) => (
        old ? { ...old, pipeline_stop_requested: true } : old
      ));
      queryClient.setQueryData(["analysis-request-meta", requestId], (old: any) => ({
        ...(old || {}),
        pipeline_stop_requested: true,
      }));
      const response = await supabase.functions.invoke("run-analysis-pipeline", {
        body: { analysisRequestId: requestId, action: "stop" },
      });
      if (response.error) throw new Error(response.error.message);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["analysis-request-row", requestId] }),
        queryClient.invalidateQueries({ queryKey: ["analysis-request-meta", requestId] }),
        queryClient.invalidateQueries({ queryKey: ["analysis-counts", requestId] }),
        queryClient.invalidateQueries({ queryKey: ["triage-results", requestId] }),
        queryClient.invalidateQueries({ queryKey: ["analysis-results", requestId] }),
      ]);
    } catch (error) {
      toast({
        title: "Stop failed",
        description: (error as any)?.message ?? "Could not stop analysis",
        variant: "destructive",
      });
    } finally {
      setAnalyzeV2Stopping(false);
    }
  };

  // Helper to get the best prefix for a class name
  const getPrefix = (className: string) =>
    sourcePrefixMap[className] || idPrefixMap[className] || className.slice(0, 3).toUpperCase();

  // File Name header metadata
  const totalSizeBytes = copiedFiles.reduce((sum, f) => sum + ((f as any).size_bytes || 0), 0);
  const sourceLabel = (sourceType || "google_drive")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c: string) => c.toUpperCase());

  // Model persistence helpers
  const updateTriageModel = (model: string) => {
    setTriageModel(model);
    supabase.from("analysis_requests").update({ triage_model: model } as any).eq("id", requestId);
  };
  const updateAnalyzeModel = (model: string) => {
    setAnalyzeModel(model);
    supabase.from("analysis_requests").update({ analyze_model: model } as any).eq("id", requestId);
  };

  // ---- Handlers ----

  const handleStop = (className: string) => {
    abortControllers.current[className]?.abort();
    // Immediately clear processing statuses so spinners disappear
    setClassFileStatuses((prev) => {
      const classStatuses = { ...(prev[className] || {}) };
      for (const fileId of Object.keys(classStatuses)) {
        if (classStatuses[fileId] === "processing") {
          delete classStatuses[fileId];
        }
      }
      return { ...prev, [className]: classStatuses };
    });
  };

  const handleSummarize = useCallback(async (awpClassName: string) => {
    setSummarizing((prev) => ({ ...prev, [awpClassName]: true }));
    try {
      const { data, error } = await supabase.functions.invoke("summarize-analysis", {
        body: { analysisRequestId: requestId, awpClassName },
      });
      if (error) throw error;
      if (data?.instances) {
        setSummarizedInstances((prev) => ({ ...prev, [awpClassName]: data.instances }));
        // Persist to DB so it survives page reloads
        const { data: req } = await supabase
          .from("analysis_requests")
          .select("summary_data")
          .eq("id", requestId)
           .single();
         const existing = (req?.summary_data as unknown as Record<string, unknown>) || {};
         await supabase
           .from("analysis_requests")
           .update({ summary_data: { ...existing, [awpClassName]: data.instances } as any })
           .eq("id", requestId);
         queryClient.invalidateQueries({ queryKey: ["analysis-request-meta", requestId] });
       }
     } catch (e) {
       console.error("Summarize failed:", e);
       toast({
         title: "Summarization Failed",
         description: e instanceof Error ? e.message : "Unknown error",
         variant: "destructive",
       });
     } finally {
       setSummarizing((prev) => ({ ...prev, [awpClassName]: false }));
     }
   }, [requestId, toast, queryClient]);

  const handleSummarizeAll = useCallback(async () => {
    if (summaryRunning) {
      summaryAbortRef.current = true;
      setSummaryRunning(false);
      return;
    }
    setSummarizedInstances({});
    setAddedToProject({});
    summaryAbortRef.current = false;
    setSummaryRunning(true);
    let aborted = false;
    try {
      for (const prompt of sortedPrompts) {
        if (summaryAbortRef.current) {
          aborted = true;
          break;
        }
        // Only summarize classes that have at least one complete result
        const hasResults = results?.some(
          (r) => r.awp_class_name === prompt.awp_class_name && r.status === "complete"
        );
        if (!hasResults) continue;
        await handleSummarize(prompt.awp_class_name);
      }

      // Dispatch completion email after a manual "Summarize All" finishes
      // (mirrors the automatic pipeline's Phase 4 → email behavior).
      if (!aborted) {
        try {
          await supabase.functions.invoke("send-analysis-complete-email", {
            body: { analysisRequestId: requestId },
          });
        } catch (emailErr) {
          console.warn("Completion email dispatch failed (non-fatal):", emailErr);
        }
      }
    } finally {
      setSummaryRunning(false);
    }
  }, [sortedPrompts, results, handleSummarize, requestId, summaryRunning]);

  // Hydrate summarized instances from DB on mount (avoids re-calling the AI)
  useEffect(() => {
    if (!savedSummaryData) return;
    setSummarizedInstances((prev) => {
      const merged = { ...prev };
      for (const [className, instances] of Object.entries(savedSummaryData)) {
        if (!merged[className]) merged[className] = instances as SummarizedInstance[];
      }
      return merged;
    });
  }, [savedSummaryData]);

  const handleAnalyze = async (prompt: AWPPrompt) => {
    if ((!prompt.drive_file_id && !prompt.prompt_content) || copiedFiles.length === 0) return;
    const className = prompt.awp_class_name;

    // Clear existing values for this class before re-analyzing
    setSummarizedInstances((prev) => { const n = { ...prev }; delete n[className]; return n; });
    setAddedToProject((prev) => { const n = { ...prev }; delete n[className]; return n; });

    // Clear saved summary for this class from DB
    (async () => {
      const { data: req } = await supabase
        .from("analysis_requests")
        .select("summary_data")
        .eq("id", requestId)
        .single();
      const existingSum = (req?.summary_data as unknown as Record<string, unknown>) || {};
      delete existingSum[className];
      await supabase
        .from("analysis_requests")
        .update({ summary_data: existingSum as any })
        .eq("id", requestId);
    })();

    // Create per-class AbortController
    const controller = new AbortController();
    abortControllers.current[className] = controller;

    setAnalyzingClasses((prev) => new Set([...prev, className]));
    setClassFileStatuses((prev) => ({ ...prev, [className]: {} }));

    // Mark analysis request as processing in DB
    await supabase.from("analysis_requests").update({ status: "processing" }).eq("id", requestId);

    let aborted = false;

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      // Use cached prompt_content first, fall back to live Drive fetch
      let promptContent = prompt.prompt_content || null;
      if (!promptContent) {
        const resolveResponse = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/resolve-drive-doc`,
          {
            method: "POST",
            signal: controller.signal,
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              fileUrl: prompt.drive_file_id,
              exportContent: true,
            }),
          }
        );

        if (!resolveResponse.ok) {
          const err = await resolveResponse.json();
          throw new Error(err.error || "Failed to fetch prompt content");
        }

        const resolveResult = await resolveResponse.json();
        promptContent = resolveResult.content;

        if (!promptContent) {
          throw new Error("Could not retrieve prompt content from the linked document");
        }
      }

      // Filter to effectively-included files based on triage + overrides
      const effectiveFiles = copiedFiles.filter(file => {
        const key = `${file.id}_${className}`;
        const triage = triageResults.get(key);
        const override = triageOverrides.get(key);

        if (override === 'exclude') return false;
        if (override === 'include') return true;
        if (triage?.status === 'complete' && triage.score !== null && triage.score >= 50) return true;
        // Skip untriaged files — pass-2 only runs on triaged cells
        if (!triage || triage.status !== 'complete') return false;
        return false;
      });

      for (const file of effectiveFiles) {
        if (controller.signal.aborted) { aborted = true; break; }

        setClassFileStatuses((prev) => ({
          ...prev,
          [className]: { ...(prev[className] || {}), [file.id]: "processing" },
        }));

        try {
          const analyzeResponse = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-drawings`,
            {
              method: "POST",
              signal: controller.signal,
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                analysisRequestId: requestId,
                fileId: file.id,
                awpClassName: className,
                promptContent,
                model: analyzeModel,
              }),
            }
          );

          setClassFileStatuses((prev) => ({
            ...prev,
            [className]: {
              ...(prev[className] || {}),
              [file.id]: analyzeResponse.ok ? "complete" : "failed",
            },
          }));

          if (analyzeResponse.ok) {
            // Invalidate after each file so counts update live as files complete
            await queryClient.invalidateQueries({ queryKey: ["analysis-results", requestId] });
          } else {
            const err = await analyzeResponse.json().catch(() => ({}));
            console.error(`Failed to analyze ${file.name}:`, err.error);
          }
        } catch (e) {
          if ((e as Error).name === "AbortError") { aborted = true; break; }
          setClassFileStatuses((prev) => ({
            ...prev,
            [className]: { ...(prev[className] || {}), [file.id]: "failed" },
          }));
          console.error(`Error analyzing ${file.name}:`, e);
        }
      }

      if (!aborted) {
        toast({ title: "Analysis Complete", description: `Finished analyzing ${effectiveFiles.length} files.` });
      }

      await queryClient.invalidateQueries({ queryKey: ["analysis-results", requestId] });

      if (!aborted) {
        // Auto-summarize removed — user triggers manually
      }
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        // silently swallow
      } else {
        toast({
          title: "Analysis Failed",
          description: error instanceof Error ? error.message : "Unknown error",
          variant: "destructive",
        });
      }
    } finally {
      setAnalyzingClasses((prev) => {
        const next = new Set(prev);
        next.delete(className);
        // If no more classes are analyzing, mark request as complete
        if (next.size === 0) {
          supabase.from("analysis_requests").update({ status: "complete" }).eq("id", requestId);
        }
        return next;
      });
      delete abortControllers.current[className];
    }
  };

  const toggleColumnDisabled = async (awpClassName: string) => {
    setDisabledColumns((prev) => {
      const next = new Set(prev);
      if (next.has(awpClassName)) {
        next.delete(awpClassName);
      } else {
        next.add(awpClassName);
      }
      disabledColumnsRef.current = next;
      // Persist to DB
      supabase
        .from("analysis_requests")
        .update({ disabled_awp_classes: [...next] } as any)
        .eq("id", requestId)
        .then();
      return next;
    });
  };

  const handleAnalyzeAll = () => {
    sortedPrompts.filter((p) => !disabledColumnsRef.current.has(p.awp_class_name)).forEach((p) => handleAnalyze(p));
  };

  // ---------------------------------------------------------------------------
  // Analyze V2: File-first workflow with concurrency pool
  // ---------------------------------------------------------------------------

  const analyzeV2QueueRef = useRef<Array<any>>([]);
  const analyzeV2TimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const analyzeV2InFlightRef = useRef(0);
  const completionFiredRef = useRef(false);
  // analyzeV2Running is declared earlier near other state
  const [analyzeV2Progress, setAnalyzeV2Progress] = useState({ done: 0, total: 0 });
  const [analyzeV2Stopping, setAnalyzeV2Stopping] = useState(false);

  const MAX_CONCURRENT_ANALYZE = 5;

  // Resolve prompt content for a single AWP class just-in-time
  const resolvePromptContent = async (prompt: AWPPrompt, token: string | undefined): Promise<string | null> => {
    // 1. Use cached prompt_content first
    if (prompt.prompt_content) return prompt.prompt_content;
    // 2. Fall back to live Drive fetch
    if (!prompt.drive_file_id) return null;
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/resolve-drive-doc`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ fileUrl: prompt.drive_file_id, exportContent: true }),
        }
      );
      if (res.ok) {
        const data = await res.json();
        return data.content || null;
      }
    } catch (e) {
      console.error(`[V2] Drive fetch failed for ${prompt.awp_class_name}:`, e);
    }
    return null;
  };


  const handleAnalyzeAllV2 = async () => {
    const enabledPrompts = sortedPrompts.filter(
      (p) => !disabledColumnsRef.current.has(p.awp_class_name) && (p.drive_file_id || p.prompt_content)
    );
    if (enabledPrompts.length === 0) {
      toast({ title: "No classes", description: "No enabled AWP classes with linked prompts." });
      return;
    }

    const processedFiles = copiedFiles.filter((f) => extractedFileIds.has(f.id));
    if (processedFiles.length === 0) {
      toast({ title: "No processed files", description: "Run Extract Context first.", variant: "destructive" });
      return;
    }

    // Mark all enabled classes as analyzing
    const allClassNames = enabledPrompts.map((p) => p.awp_class_name);
    analyzeRunSyncRef.current = "starting";
    completionFiredRef.current = false;
    hasTriggeredResumeRef.current = true;
    setAnalyzingClasses(new Set(allClassNames));
    setAnalyzeV2Running(true);
    setClassFileStatuses({});
    setAnalyzeTokens(0);
    analyzeTokensRef.current = 0;

    // Mark Start as locally pending; the canonical hook masks stale rows
    // until the row's analysis_run_id changes (or 30s safety timeout).
    requestState.beginLocalStart();
    await supabase.from("analysis_requests").update({ status: "processing" }).eq("id", requestId);

    // Clear existing analysis results and summaries for enabled classes
    await Promise.all(
      allClassNames.map((cn) =>
        supabase.from("analysis_results").delete().eq("analysis_request_id", requestId).eq("awp_class_name", cn)
      )
    );
    // Clear saved summaries
    const { data: req } = await supabase.from("analysis_requests").select("summary_data").eq("id", requestId).single();
    const existingSum = (req?.summary_data as unknown as Record<string, unknown>) || {};
    for (const cn of allClassNames) {
      delete existingSum[cn];
      setSummarizedInstances((prev) => { const n = { ...prev }; delete n[cn]; return n; });
      setAddedToProject((prev) => { const n = { ...prev }; delete n[cn]; return n; });
    }
    await supabase.from("analysis_requests").update({ summary_data: existingSum as any }).eq("id", requestId);
    queryClient.invalidateQueries({ queryKey: ["analysis-results", requestId] });

    // Build a prompt lookup by class name for queue items
    const promptByClass = new Map<string, AWPPrompt>();
    for (const p of enabledPrompts) {
      promptByClass.set(p.awp_class_name, p);
    }

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      // Build per-file eligible class lists and check cached openai file IDs
      interface FileGroup {
        file: typeof processedFiles[0];
        eligibleClasses: string[];
        cachedOpenaiFileId: string | null;
      }
      const fileGroups: FileGroup[] = [];

      for (const file of processedFiles) {
        const eligibleClasses: string[] = [];
        for (const prompt of enabledPrompts) {
          const key = `${file.id}_${prompt.awp_class_name}`;
          const override = triageOverrides.get(key);
          const triage = triageResults.get(key);

          if (override === "exclude") continue;
          if (override === "include") { eligibleClasses.push(prompt.awp_class_name); continue; }
          if (triage?.status === "complete" && triage.score !== null && triage.score >= 50) {
            eligibleClasses.push(prompt.awp_class_name);
          }
        }
        if (eligibleClasses.length === 0) continue;

        let cachedOpenaiFileId: string | null = null;
        const { data: fileRow } = await supabase
          .from("analysis_request_files")
          .select("openai_file_id, openai_file_uploaded_at, openai_file_expires_at, openai_file_status")
          .eq("id", file.id)
          .single();

        if (fileRow?.openai_file_id && fileRow.openai_file_status !== "invalid") {
          const uploadedAt = fileRow.openai_file_uploaded_at ? new Date(fileRow.openai_file_uploaded_at).getTime() : 0;
          const LOCAL_TTL = 71 * 60 * 60 * 1000 + 45 * 60 * 1000;
          if (Date.now() - uploadedAt < LOCAL_TTL) {
            cachedOpenaiFileId = fileRow.openai_file_id;
          }
        }

        fileGroups.push({ file, eligibleClasses, cachedOpenaiFileId });
      }

      if (fileGroups.length === 0) {
        toast({ title: "No eligible files", description: "No files meet the triage threshold." });
        setAnalyzeV2Running(false);
        setAnalyzingClasses(new Set());
        await supabase.from("analysis_requests").update({ status: "complete" }).eq("id", requestId);
        return;
      }

      // Track per-file openai IDs as they get resolved
      const fileOpenaiIds = new Map<string, string>();
      for (const g of fileGroups) {
        if (g.cachedOpenaiFileId) fileOpenaiIds.set(g.file.id, g.cachedOpenaiFileId);
      }

      // Build work queue: horizontal-first (all classes for file1, then file2, etc.)
      // Items that need upload go first in their file group
      interface WorkItem {
        fileId: string;
        awpClassName: string;
        prompt: AWPPrompt;
        fileName: string;
        needsUpload: boolean; // true for the first class of a file that has no cached ID
      }
      const workQueue: WorkItem[] = [];
      let totalItems = 0;

      for (const group of fileGroups) {
        const hasCache = !!group.cachedOpenaiFileId;
        for (let i = 0; i < group.eligibleClasses.length; i++) {
          const cn = group.eligibleClasses[i];
          const prompt = promptByClass.get(cn);
          if (!prompt) continue;
          workQueue.push({
            fileId: group.file.id,
            awpClassName: cn,
            prompt,
            fileName: group.file.name,
            needsUpload: !hasCache && i === 0, // first class of uncached file triggers upload
          });
          totalItems++;
        }
      }

      if (totalItems === 0) {
        toast({ title: "Analysis Complete", description: "All eligible files processed." });
        analyzeRunSyncRef.current = "idle";
        setAnalyzeV2Running(false);
        setAnalyzingClasses(new Set());
        await supabase.from("analysis_requests").update({ status: "complete" }).eq("id", requestId);
        // Auto-summarize removed — user triggers manually
        return;
      }

      // Execution function for each work item
      // NOTE: inFlight is incremented BEFORE calling executeItem (at dequeue site)
      const executeItem = async (item: WorkItem) => {
        try {
          const { data: sd } = await supabase.auth.getSession();
          const tk = sd.session?.access_token;

          setClassFileStatuses((prev) => ({
            ...prev,
            [item.awpClassName]: { ...(prev[item.awpClassName] || {}), [item.fileId]: "processing" },
          }));

          // Resolve prompt content JIT
          const promptContent = await resolvePromptContent(item.prompt, tk ?? undefined);
          if (!promptContent) {
            console.warn(`[V2] No prompt for ${item.awpClassName}, marking failed`);
            setClassFileStatuses((prev) => ({
              ...prev,
              [item.awpClassName]: { ...(prev[item.awpClassName] || {}), [item.fileId]: "failed" },
            }));
            return;
          }

          // Get or wait for the openai file ID
          let openaiFileId = fileOpenaiIds.get(item.fileId) || null;

          if (!openaiFileId && item.needsUpload) {
            // This item is responsible for uploading the file
            setUploadingFileIds((prev) => { const n = new Set(prev); n.add(item.fileId); return n; });

            const uploadResponse = await fetch(
              `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-drawings`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${tk}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  analysisRequestId: requestId,
                  fileId: item.fileId,
                  awpClassName: item.awpClassName,
                  promptContent,
                  model: analyzeModel,
                }),
              }
            );

            setUploadingFileIds((prev) => { const n = new Set(prev); n.delete(item.fileId); return n; });

            if (uploadResponse.ok) {
              const data = await uploadResponse.json();
              openaiFileId = data.openaiFileId || null;
              if (openaiFileId) fileOpenaiIds.set(item.fileId, openaiFileId);
              if (data.usage?.total_tokens) {
                analyzeTokensRef.current += data.usage.total_tokens;
                setAnalyzeTokens(analyzeTokensRef.current);
                supabase.from("analysis_requests").update({ analyze_tokens_used: analyzeTokensRef.current } as any).eq("id", requestId);
              }
              setClassFileStatuses((prev) => ({
                ...prev,
                [item.awpClassName]: { ...(prev[item.awpClassName] || {}), [item.fileId]: "complete" },
              }));
              await queryClient.invalidateQueries({ queryKey: ["analysis-results", requestId] });
            } else {
              const err = await uploadResponse.json().catch(() => ({}));
              console.error(`[V2] Upload+analyze failed for ${item.fileName}/${item.awpClassName}:`, err.error);
              setClassFileStatuses((prev) => ({
                ...prev,
                [item.awpClassName]: { ...(prev[item.awpClassName] || {}), [item.fileId]: "failed" },
              }));
              // Mark remaining items for this file as failed since we have no file ID
              analyzeV2QueueRef.current = analyzeV2QueueRef.current.map((qi) =>
                qi.fileId === item.fileId ? { ...qi, needsUpload: false } : qi
              );
            }
            return;
          }

          if (!openaiFileId) {
            // Wait briefly for the upload item to finish (poll the map)
            for (let attempt = 0; attempt < 120; attempt++) {
              openaiFileId = fileOpenaiIds.get(item.fileId) || null;
              if (openaiFileId) break;
              await new Promise((r) => setTimeout(r, 1000));
            }
          }

          if (!openaiFileId) {
            console.warn(`[V2] No openaiFileId available for ${item.fileName}/${item.awpClassName}`);
            setClassFileStatuses((prev) => ({
              ...prev,
              [item.awpClassName]: { ...(prev[item.awpClassName] || {}), [item.fileId]: "failed" },
            }));
            return;
          }

          // Standard analyze call with existing file ID
          const analyzeResponse = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-drawings`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${tk}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                analysisRequestId: requestId,
                fileId: item.fileId,
                awpClassName: item.awpClassName,
                promptContent,
                model: analyzeModel,
                openaiFileId,
              }),
            }
          );

          setClassFileStatuses((prev) => ({
            ...prev,
            [item.awpClassName]: {
              ...(prev[item.awpClassName] || {}),
              [item.fileId]: analyzeResponse.ok ? "complete" : "failed",
            },
          }));

          if (analyzeResponse.ok) {
            const data = await analyzeResponse.json();
            if (data.usage?.total_tokens) {
              analyzeTokensRef.current += data.usage.total_tokens;
              setAnalyzeTokens(analyzeTokensRef.current);
              supabase.from("analysis_requests").update({ analyze_tokens_used: analyzeTokensRef.current } as any).eq("id", requestId);
            }
            await queryClient.invalidateQueries({ queryKey: ["analysis-results", requestId] });
          } else {
            const err = await analyzeResponse.json().catch(() => ({}));
            console.error(`[V2] Failed ${item.fileName}/${item.awpClassName}:`, err.error);
          }
        } catch (e) {
          setClassFileStatuses((prev) => ({
            ...prev,
            [item.awpClassName]: { ...(prev[item.awpClassName] || {}), [item.fileId]: "failed" },
          }));
          console.error(`[V2] Error ${item.fileName}/${item.awpClassName}:`, e);
        } finally {
          analyzeV2InFlightRef.current--;
          setAnalyzeV2Progress((prev) => ({ ...prev, done: prev.done + 1 }));
        }
      };

      // Start scheduler
      analyzeV2QueueRef.current = workQueue as any;
      analyzeV2InFlightRef.current = 0;
      setAnalyzeV2Progress({ done: 0, total: totalItems });

      // Group-aware dequeue: only dequeue items from the earliest file group
      // that still has pending items, enforcing row-by-row sequential execution.
      const dequeueItems = () => {
        const queue = analyzeV2QueueRef.current;
        const activeFileIds = new Set<string>();
        Object.values(classFileStatuses).forEach((fileMap) => {
          Object.entries(fileMap).forEach(([fileId, status]) => {
            if (status === "processing") activeFileIds.add(fileId);
          });
        });

        const currentFileId = activeFileIds.size > 0 ? Array.from(activeFileIds)[0] : queue[0]?.fileId;
        if (!currentFileId) return;

        while (analyzeV2InFlightRef.current < MAX_CONCURRENT_ANALYZE) {
          const idx = queue.findIndex((q: any) => q.fileId === currentFileId);
          if (idx === -1) break;
          const item = queue[idx];
          analyzeV2InFlightRef.current++;
          queue.splice(idx, 1);
          executeItem(item as any);
        }
      };

      const startV2Scheduler = () => {
        analyzeV2TimerRef.current = setInterval(() => {
          // Check completion FIRST, guard with flag
          if (analyzeV2QueueRef.current.length === 0 && analyzeV2InFlightRef.current <= 0) {
            // Clear interval synchronously BEFORE any async work
            if (analyzeV2TimerRef.current) {
              clearInterval(analyzeV2TimerRef.current);
              analyzeV2TimerRef.current = null;
            }
            if (completionFiredRef.current) return;
            completionFiredRef.current = true;
            (async () => {
              await queryClient.invalidateQueries({ queryKey: ["analysis-results", requestId] });
              analyzeRunSyncRef.current = "idle";
              setAnalyzeV2Running(false);
              setAnalyzingClasses(new Set());
              await supabase.from("analysis_requests").update({ status: "complete" }).eq("id", requestId);
              toast({ title: "Analysis Complete", description: "All files analyzed." });
              // Auto-summarize removed — user triggers manually
            })();
            return;
          }
          dequeueItems();
        }, 1000);

        // Immediately fire first batch
        dequeueItems();
      };

      startV2Scheduler();
    } catch (error) {
      console.error("[V2] Unhandled error:", error);
      toast({
        title: "Analysis Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
      analyzeRunSyncRef.current = "idle";
      setAnalyzeV2Running(false);
      setAnalyzingClasses(new Set());
    }
  };

  const handleStopAnalyzeV2 = () => {
    analyzeRunSyncRef.current = "stopping";
    completionFiredRef.current = true;
    analyzeV2QueueRef.current = [];
    if (analyzeV2TimerRef.current) {
      clearInterval(analyzeV2TimerRef.current);
      analyzeV2TimerRef.current = null;
    }
    setAnalyzeV2Stopping(true);
    const stopRunMarker = Date.now();
    const pollId = setInterval(() => {
      const isSameStopCycle = analyzeRunSyncRef.current === "stopping";
      if (!isSameStopCycle) {
        clearInterval(pollId);
        return;
      }
      if (analyzeV2InFlightRef.current <= 0) {
        clearInterval(pollId);
        queryClient.invalidateQueries({ queryKey: ["analysis-results", requestId] });
        analyzeRunSyncRef.current = "idle";
        setAnalyzeV2Running(false);
        setAnalyzeV2Stopping(false);
        setAnalyzingClasses(new Set());
        setClassFileStatuses({});
        void supabase.from("analysis_requests").update({ status: "started" }).eq("id", requestId);
      }
    }, 200);
  };

  // ---- Triage All with concurrency guard ----

  const executeTriageItem = async (item: { file: AnalysisFile; prompt?: AWPPrompt; action: "extract" | "triage" }) => {
    inFlightCountRef.current++;
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      if (item.action === "extract") {
        // Phase 1: extract text only
        setExtractingFileIds((prev) => { const next = new Set(prev); next.add(item.file.id); return next; });
        let response: Response | null = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          response = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/triage-drawings`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ fileId: item.file.id, action: "extract" }),
            }
          );
          if (response.status !== 503) break;
          console.warn(`[extract] 503 on attempt ${attempt + 1} for ${item.file.name}, retrying...`);
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        }
        // We don't track tokens for extraction (no AI call)
        if (response.ok) {
          const data = await response.json();
          console.log(`[triage] Extracted text for ${item.file.name}: ${data.textLength} chars`);
          // Fetch extracted text for tooltip
          const { data: fileRow } = await supabase
            .from("analysis_request_files")
            .select("extracted_text")
            .eq("id", item.file.id)
            .single();
          if (fileRow?.extracted_text) {
            setExtractedTexts((prev) => { const next = new Map(prev); next.set(item.file.id, fileRow.extracted_text as string); return next; });
          }
        }
        setExtractingFileIds((prev) => { const next = new Set(prev); next.delete(item.file.id); return next; });
        setExtractedFileIds((prev) => { const next = new Set(prev); next.add(item.file.id); return next; });
      } else {
        // Phase 2: triage scoring
        const prompt = item.prompt!;
        const key = `${item.file.id}_${prompt.awp_class_name}`;

        // Mark as processing locally
        setTriageResults((prev) => {
          const next = new Map(prev);
          next.set(key, { file_id: item.file.id, awp_class_name: prompt.awp_class_name, status: "processing", score: null, reason: null, error_message: null, instances: null });
          return next;
        });

        const triageBody = JSON.stringify({
          analysisRequestId: requestId,
          fileId: item.file.id,
          awpClassName: prompt.awp_class_name,
          assetType: prompt.category,
          drawingName: item.file.name,
          promptContent: prompt.triage_prompt_content || prompt.prompt_content || null,
          action: "triage",
          model: triageModel,
        });
        let response: Response | null = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          response = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/triage-drawings`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
              body: triageBody,
            }
          );
          if (response.status !== 503) break;
          console.warn(`[triage] 503 on attempt ${attempt + 1} for ${item.file.name}/${prompt.awp_class_name}, retrying...`);
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        }

        if (response.ok) {
          const data = await response.json();
          setTriageResults((prev) => {
            const next = new Map(prev);
             next.set(key, {
               file_id: item.file.id,
               awp_class_name: prompt.awp_class_name,
               status: "complete",
               score: data.score ?? 0,
               reason: data.reason ?? "",
               error_message: null,
               instances: data.instances ?? null,
             });
            return next;
          });
          if (data.usage?.total_tokens) {
            const tokens = data.usage.total_tokens;
            setTriageTokens((prev) => {
              const newTotal = prev + tokens;
              // Persist to DB
              supabase.from("analysis_requests").update({ triage_tokens_used: newTotal } as any).eq("id", requestId);
              return newTotal;
            });
          }
        } else {
          setTriageResults((prev) => {
            const next = new Map(prev);
            next.set(key, { file_id: item.file.id, awp_class_name: prompt.awp_class_name, status: "failed", score: null, reason: null, error_message: "Triage failed", instances: null });
            return next;
          });
        }
      }
    } catch (e) {
      if (item.action === "triage" && item.prompt) {
        const key = `${item.file.id}_${item.prompt.awp_class_name}`;
        setTriageResults((prev) => {
          const next = new Map(prev);
          next.set(key, { file_id: item.file.id, awp_class_name: item.prompt!.awp_class_name, status: "failed", score: null, reason: null, error_message: String(e), instances: null });
          return next;
        });
      }
    } finally {
      inFlightCountRef.current--;
      setTriageProgress((prev) => ({ ...prev, done: prev.done + 1 }));
    }
  };

  const startTriageScheduler = (onComplete: () => void, maxConcurrency: number = MAX_CONCURRENT_TRIAGE) => {
    triageTimerRef.current = setInterval(() => {
      while (
        inFlightCountRef.current < maxConcurrency &&
        triageQueueRef.current.length > 0
      ) {
        const item = triageQueueRef.current.shift()!;
        if (disabledColumnsRef.current.has(item.prompt.awp_class_name)) continue;
        executeTriageItem(item);
      }
      if (triageQueueRef.current.length === 0 && inFlightCountRef.current <= 0) {
        if (triageTimerRef.current) {
          clearInterval(triageTimerRef.current);
          triageTimerRef.current = null;
        }
        onComplete();
      }
    }, 1000);

    // Immediately fire first batch
    while (
      inFlightCountRef.current < maxConcurrency &&
      triageQueueRef.current.length > 0
    ) {
      const item = triageQueueRef.current.shift()!;
      if (disabledColumnsRef.current.has(item.prompt.awp_class_name)) continue;
      executeTriageItem(item);
    }
  };

  // ---- Extract Context handler ----
  const handleExtractAll = async () => {
    // Clear all extracted_text in DB
    await supabase
      .from("analysis_request_files")
      .update({ extracted_text: null } as any)
      .eq("analysis_request_id", requestId);

    // Clear local state
    setExtractedFileIds(new Set());
    setExtractingFileIds(new Set());
    setExtractedTexts(new Map());

    if (copiedFiles.length === 0) {
      toast({ title: "No files", description: "No files available for extraction." });
      return;
    }

    setExtractRunning(true);
    setExtractStopping(false);
    setExtractProgress({ done: 0, total: copiedFiles.length });
    inFlightCountRef.current = 0;

    // Mark request as processing
    await supabase.from("analysis_requests").update({ status: "processing" }).eq("id", requestId);
    queryClient.invalidateQueries({ queryKey: ["analysis-request-meta", requestId] });

    extractQueueRef.current = copiedFiles.map((f) => ({ file: f, action: "extract" as const }));

    const runExtractScheduler = () => {
      extractTimerRef.current = setInterval(() => {
        while (
          inFlightCountRef.current < MAX_CONCURRENT_TRIAGE &&
          extractQueueRef.current.length > 0
        ) {
          const item = extractQueueRef.current.shift()!;
          executeTriageItem(item);
        }
        if (extractQueueRef.current.length === 0 && inFlightCountRef.current <= 0) {
          if (extractTimerRef.current) {
            clearInterval(extractTimerRef.current);
            extractTimerRef.current = null;
          }
          setExtractRunning(false);
          // Mark request as started (idle between phases)
          supabase.from("analysis_requests").update({ status: "started" }).eq("id", requestId);
          queryClient.invalidateQueries({ queryKey: ["analysis-request-meta", requestId] });
        }
      }, 1000);

      // Immediately fire first batch
      while (
        inFlightCountRef.current < MAX_CONCURRENT_TRIAGE &&
        extractQueueRef.current.length > 0
      ) {
        const item = extractQueueRef.current.shift()!;
        executeTriageItem(item);
      }
    };

    // Use a separate progress tracker for extraction
    setTriageProgress({ done: 0, total: copiedFiles.length });
    runExtractScheduler();
  };

  const handleStopExtract = () => {
    extractQueueRef.current = [];
    if (extractTimerRef.current) {
      clearInterval(extractTimerRef.current);
      extractTimerRef.current = null;
    }
    setExtractStopping(true);
    const pollId = setInterval(() => {
      if (inFlightCountRef.current <= 0) {
        clearInterval(pollId);
        setExtractRunning(false);
        setExtractStopping(false);
        // Mark request as started (stopped mid-phase)
        supabase.from("analysis_requests").update({ status: "started" }).eq("id", requestId);
        queryClient.invalidateQueries({ queryKey: ["analysis-request-meta", requestId] });
      }
    }, 200);
  };

  const handleTriageClass = async (prompt: AWPPrompt) => {
    const processedFiles = copiedFiles.filter((f) => extractedFileIds.has(f.id));
    if (processedFiles.length === 0) {
      toast({ title: "No processed files", description: "Run Extract Context first.", variant: "destructive" });
      return;
    }

    const className = prompt.awp_class_name;

    // Clear previous triage results for this class only
    setTriageResults((prev) => {
      const next = new Map(prev);
      for (const [key] of next) {
        if (key.endsWith(`_${className}`)) next.delete(key);
      }
      return next;
    });

    // Clear pass-2 results for this class
    setSummarizedInstances((prev) => { const n = { ...prev }; delete n[className]; return n; });
    setAddedToProject((prev) => { const n = { ...prev }; delete n[className]; return n; });

    // Clear overrides for this class
    setTriageOverrides((prev) => {
      const next = new Map(prev);
      for (const [key] of next) {
        if (key.endsWith(`_${className}`)) next.delete(key);
      }
      return next;
    });

    // Delete existing DB triage/analysis results for this class
    await Promise.all([
      supabase.from("analysis_triage_results").delete().eq("analysis_request_id", requestId).eq("awp_class_name", className),
      supabase.from("analysis_results").delete().eq("analysis_request_id", requestId).eq("awp_class_name", className),
      supabase.from("analysis_triage_overrides" as any).delete().eq("analysis_request_id", requestId).eq("awp_class_name", className),
    ]);

    // Clear summary_data for this class
    const { data: req } = await supabase.from("analysis_requests").select("summary_data").eq("id", requestId).single();
    const existingSum = (req?.summary_data as unknown as Record<string, unknown>) || {};
    delete existingSum[className];
    await supabase.from("analysis_requests").update({ summary_data: existingSum as any }).eq("id", requestId);

    queryClient.invalidateQueries({ queryKey: ["triage-results", requestId] });
    queryClient.invalidateQueries({ queryKey: ["analysis-results", requestId] });
    queryClient.invalidateQueries({ queryKey: ["triage-overrides", requestId] });

    // Build queue for this class only
    const scoreQueue: Array<{ file: AnalysisFile; prompt: AWPPrompt; action: "extract" | "triage" }> = [];
    for (const file of processedFiles) {
      scoreQueue.push({ file, prompt, action: "triage" });
    }

    setTriageRunning(true);
    setTriagingClasses((prev) => new Set(prev).add(className));
    inFlightCountRef.current = 0;
    setTriagePhase("score");
    setTriageProgress({ done: 0, total: scoreQueue.length });
    triageQueueRef.current = scoreQueue;

    // Mark request as processing
    await supabase.from("analysis_requests").update({ status: "processing" }).eq("id", requestId);
    queryClient.invalidateQueries({ queryKey: ["analysis-request-meta", requestId] });

    startTriageScheduler(() => {
      queryClient.invalidateQueries({ queryKey: ["triage-results", requestId] });
      setTriagingClasses((prev) => { const next = new Set(prev); next.delete(className); return next; });
      setTriageRunning(false);
      setTriagePhase(null);
      // Mark request as started (idle between phases)
      supabase.from("analysis_requests").update({ status: "started" }).eq("id", requestId);
      queryClient.invalidateQueries({ queryKey: ["analysis-request-meta", requestId] });
    }, MAX_CONCURRENT_TRIAGE_SINGLE);
  };

  const handleTriageAll = async () => {
    // Check that we have processed files
    const processedFiles = copiedFiles.filter((f) => extractedFileIds.has(f.id));
    if (processedFiles.length === 0) {
      toast({ title: "No processed files", description: "Run Extract Context first.", variant: "destructive" });
      return;
    }

    // Clear previous triage results
    setTriageResults(new Map());
    setTriageTokens(0);

    // Clear pass-2 results and overrides
    setSummarizedInstances({});
    setAddedToProject({});
    setTriageOverrides(new Map());

    // Delete existing DB triage results, pass-2 results, overrides, and reset token count + summary_data
    await Promise.all([
      supabase.from("analysis_triage_results").delete().eq("analysis_request_id", requestId),
      supabase.from("analysis_results").delete().eq("analysis_request_id", requestId),
      supabase.from("analysis_triage_overrides" as any).delete().eq("analysis_request_id", requestId),
      supabase.from("analysis_requests").update({ triage_tokens_used: 0, summary_data: {} } as any).eq("id", requestId),
    ]);
    queryClient.invalidateQueries({ queryKey: ["triage-results", requestId] });
    queryClient.invalidateQueries({ queryKey: ["analysis-results", requestId] });
    queryClient.invalidateQueries({ queryKey: ["triage-overrides", requestId] });
    queryClient.invalidateQueries({ queryKey: ["analysis-request-meta", requestId] });

    // Build score queue: only for processed files
    const scoreQueue: Array<{ file: AnalysisFile; prompt: AWPPrompt; action: "extract" | "triage" }> = [];
    const enabledPrompts = sortedPrompts.filter((p) => !disabledColumns.has(p.awp_class_name));
    for (const prompt of enabledPrompts) {
      for (const file of processedFiles) {
        scoreQueue.push({ file, prompt, action: "triage" });
      }
    }

    if (scoreQueue.length === 0) {
      toast({ title: "Nothing to triage", description: "No files available." });
      return;
    }

    const allClassNames = new Set(enabledPrompts.map((p) => p.awp_class_name));
    setTriageRunning(true);
    setTriagingClasses(allClassNames);
    inFlightCountRef.current = 0;
    setTriagePhase("score");
    setTriageProgress({ done: 0, total: scoreQueue.length });
    triageQueueRef.current = scoreQueue;

    // Mark request as processing
    await supabase.from("analysis_requests").update({ status: "processing" }).eq("id", requestId);
    queryClient.invalidateQueries({ queryKey: ["analysis-request-meta", requestId] });

    startTriageScheduler(() => {
      queryClient.invalidateQueries({ queryKey: ["triage-results", requestId] });
      setTriagingClasses(new Set());
      setTriageRunning(false);
      setTriagePhase(null);
      // Mark request as started (idle between phases)
      supabase.from("analysis_requests").update({ status: "started" }).eq("id", requestId);
      queryClient.invalidateQueries({ queryKey: ["analysis-request-meta", requestId] });
    });
  };

  const [triageStopping, setTriageStopping] = useState(false);

  const handleStopTriage = () => {
    triageQueueRef.current = [];
    if (triageTimerRef.current) {
      clearInterval(triageTimerRef.current);
      triageTimerRef.current = null;
    }
    setTriageStopping(true);
    const pollId = setInterval(() => {
      if (inFlightCountRef.current <= 0) {
        clearInterval(pollId);
        // Invalidate FIRST so fresh data is fetched before hydration fires
        queryClient.invalidateQueries({ queryKey: ["triage-results", requestId] });
        setTriageRunning(false);
        setTriagePhase(null);
        setTriageStopping(false);
        // Mark request as started (stopped mid-phase)
        supabase.from("analysis_requests").update({ status: "started" }).eq("id", requestId);
        queryClient.invalidateQueries({ queryKey: ["analysis-request-meta", requestId] });
      }
    }, 200);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (triageTimerRef.current) clearInterval(triageTimerRef.current);
      if (extractTimerRef.current) clearInterval(extractTimerRef.current);
      if (analyzeV2TimerRef.current) clearInterval(analyzeV2TimerRef.current);
    };
  }, []);

  const handleDownloadZip = async () => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/download-analysis-files-zip?analysisRequestId=${requestId}`;
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `analysis-files-${requestId}.zip`;
      a.click();
      URL.revokeObjectURL(blobUrl);
    } catch (e) {
      toast({ title: "Download failed", description: String(e), variant: "destructive" });
    }
  };

  // ---- Delete a single file from the analysis ----
  const [fileToDelete, setFileToDelete] = useState<AnalysisFile | null>(null);
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);

  const handleDeleteFile = async (file: AnalysisFile) => {
    setDeletingFileId(file.id);
    try {
      // Best-effort storage cleanup
      if (file.storage_path) {
        const { error: storageErr } = await supabase
          .storage
          .from("uploaded-drawings")
          .remove([file.storage_path]);
        if (storageErr) {
          console.warn("Storage delete warning:", storageErr.message);
        }
      }

      // Clean up dependent rows that reference this file
      await Promise.all([
        supabase.from("analysis_results").delete().eq("file_id", file.id),
        supabase.from("analysis_triage_results").delete().eq("file_id", file.id),
        supabase.from("analysis_triage_overrides").delete().eq("file_id", file.id),
      ]);

      // Delete the file row itself
      const { error: rowErr } = await supabase
        .from("analysis_request_files")
        .delete()
        .eq("id", file.id);
      if (rowErr) throw rowErr;

      // Update analysis_requests aggregate counters and reset status if last file
      const remaining = (copiedFiles || []).filter(f => f.id !== file.id);
      const newFileCount = remaining.length;
      const newTotalBytes = remaining.reduce((s, f) => s + ((f as any).size_bytes || 0), 0);

      const updates: Record<string, any> = {
        file_count: newFileCount,
        total_size_bytes: newTotalBytes,
      };
      if (newFileCount === 0) {
        updates.status = "awaiting_upload";
        updates.error_message = null;
        updates.summary_data = {};
        updates.pipeline_phase = null;
        updates.pipeline_progress_done = 0;
        updates.pipeline_progress_total = 0;
      }
      await supabase.from("analysis_requests").update(updates).eq("id", requestId);

      toast({ title: "File deleted", description: file.name });

      // Refresh queries — invalidate broadly so both AnalysisRequestDetail and WMSV pages update
      await queryClient.invalidateQueries({ queryKey: ["analysis-files", requestId] });
      await queryClient.invalidateQueries({ queryKey: ["wmsv-analysis-files", requestId] });
      await queryClient.invalidateQueries({ queryKey: ["analysis-request-meta", requestId] });
      await queryClient.invalidateQueries({ queryKey: ["wmsv-analysis-request"] });
      await queryClient.invalidateQueries({ queryKey: ["analysis-request"] });
    } catch (e) {
      toast({
        title: "Failed to delete file",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setDeletingFileId(null);
      setFileToDelete(null);
    }
  };

  const handleAddToProject = async (awpClassName: string) => {
    const instances = summarizedInstances[awpClassName];
    if (!instances || instances.length === 0 || !projectId) return;

    setAddingToProject((prev) => ({ ...prev, [awpClassName]: true }));
    try {
      // Use source-of-truth prefix maps (built from critical_assets/water_systems/processes)
      const idPrefix = sourcePrefixMap[awpClassName] || idPrefixMap[awpClassName] ||
        awpClassName.replace(/[^a-zA-Z]/g, "").substring(0, 3).toUpperCase();

      // Derive category from awpOrderData globalOrder
      const orderEntry = (awpOrderData || []).find(x => x.name === awpClassName);
      const category = orderEntry
        ? (orderEntry.globalOrder < 1000 ? "Asset" : orderEntry.globalOrder < 2000 ? "Water System" : "Process")
        : "Asset";

      // Still try to get awpClassId for the DB record
      const awpClass = awpClasses?.find(c => c.name === awpClassName);
      const awpClassId = awpClass?.id || null;

      const { data: existingItems } = await supabase
        .from("project_analysis_items")
        .select("item_id")
        .eq("project_id", projectId)
        .eq("name", awpClassName);

      const existingCount = existingItems?.length || 0;

      let defaultControlNames: string[] = [];
      const sourceTable =
        category === "Asset" ? "critical_assets" :
        category === "Water System" ? "water_systems" : "processes";

      const { data: sourceEntry } = await supabase
        .from(sourceTable as any)
        .select("default_control_ids")
        .eq("name", awpClassName)
        .maybeSingle();

      if ((sourceEntry as any)?.default_control_ids?.length) {
        const { data: controls } = await supabase
          .from("mitigation_controls")
          .select("name")
          .in("id", (sourceEntry as any).default_control_ids);
        defaultControlNames = controls?.map((c) => c.name) || [];
      }

      // Fetch analysis result files for source file info
      const analysisResults = results?.filter(
        (r) => r.awp_class_name === awpClassName && r.status === "complete" && r.result_text
      ) || [];
      const fileIds = [...new Set(analysisResults.map((r) => r.file_id))];
      let fileStoragePaths: Record<string, { storagePath: string; fileName: string }> = {};
      if (fileIds.length > 0) {
        const { data: fileRecords } = await supabase
          .from("analysis_request_files")
          .select("id, storage_path, name")
          .in("id", fileIds);
        for (const f of fileRecords || []) {
          if (f.storage_path) {
            fileStoragePaths[f.id] = { storagePath: f.storage_path, fileName: f.name };
          }
        }
      }

      const rows = instances.map((inst, idx) => {
        const seqNum = existingCount + idx + 1;
        const itemId = `${idPrefix}${String(seqNum).padStart(3, "0")}`;

        // Build additional_parameters with pipe diameter if available
        const additionalParameters: Record<string, any> = {};
        if (inst.pipe_diameter_mm && inst.pipe_diameter_mm > 0) {
          additionalParameters.pipeDiameterMM = inst.pipe_diameter_mm;
          additionalParameters.pipeDiameterInches = parseFloat((inst.pipe_diameter_mm / 25.4).toFixed(1));
        }

        // Find matching analysis result to get source file info and bounding box
        let fileName: string | null = null;
        let drawingUrl: string | null = null;
        let coordinates: number[] | null = null;
        // Try to match instance to a result file by checking result_text for the instance id
        for (const ar of analysisResults) {
          if (!ar.result_text) continue;

          const matchingRow = findMatchingOverlayRow(parseOverlayCandidates(ar.result_text), inst.id);
          if (!matchingRow) continue;

          const fileInfo = fileStoragePaths[ar.file_id];
          if (fileInfo) {
            fileName = fileInfo.fileName;
            drawingUrl = fileInfo.storagePath;
          }

          if (matchingRow.aiBBox) {
            coordinates = [
              matchingRow.aiBBox.x1,
              matchingRow.aiBBox.y1,
              matchingRow.aiBBox.x2,
              matchingRow.aiBBox.y2,
            ];
          }

          break;
        }
        // Fallback: if only one file, use it
        if (!drawingUrl && Object.keys(fileStoragePaths).length === 1) {
          const only = Object.values(fileStoragePaths)[0];
          fileName = only.fileName;
          drawingUrl = only.storagePath;
        }

        return {
          project_id: projectId,
          item_id: itemId,
          name: awpClassName,
          area_name: inst.name,
          category: category,
          floor: inst.floor || null,
          area_sqft: inst.area_sqft || null,
          awp_class_id: awpClassId,
          controls: defaultControlNames.length > 0 ? defaultControlNames : null,
          additional_parameters: Object.keys(additionalParameters).length > 0 ? additionalParameters : null,
          file_name: fileName,
          drawing_url: drawingUrl,
          coordinates: coordinates,
          drawing_code: inst.id || null,
        };
      });

      const { error } = await supabase.from("project_analysis_items").insert(rows);
      if (error) throw error;

      setAddedToProject((prev) => ({ ...prev, [awpClassName]: true }));
      toast({
        title: "Added to Project",
        description: `${rows.length} ${awpClassName} instances added to the project.`,
        duration: 3000,
      });
    } catch (e) {
      toast({
        title: "Failed to Add",
        description: (e as any)?.message || "Unknown error",
        variant: "destructive",
      });
    } finally {
      setAddingToProject((prev) => ({ ...prev, [awpClassName]: false }));
    }
  };

  // ---- Cell helpers ----

  type CellValue = "loading" | "failed" | number | null;

  /**
   * Returns the per-file raw mention count derived from result_text.
   * Used by the cell renderer; the cell separately decides whether to
   * substitute the deduped class-level summary count (and show a tooltip)
   * when exactly one file contributed to that class.
   */
  const countForCell = (fileId: string, className: string): CellValue => {
    const liveStatus = classFileStatuses[className]?.[fileId];
    if (liveStatus === "processing") return "loading";
    if (liveStatus === "failed") return "failed";

    const result = results?.find((r) => r.file_id === fileId && r.awp_class_name === className);
    if (!result) return null;
    if (result.status === "processing") return "loading";
    if (result.status === "failed") return "failed";
    if (result.status === "complete" && result.result_text) {
      const parsed = parseResultText(result.result_text);
      return parsed.length;
    }
    return null;
  };

  /**
   * For a (fileId, className) cell, return the deduped count to display when
   * the class maps unambiguously to ONE complete-result file (the common
   * single-parent-PDF case). Returns null if multiple files contributed —
   * caller should fall back to the per-file raw count without implying the
   * class total belongs to that one file.
   */
  const dedupedCountForCell = (
    fileId: string,
    className: string,
  ): { deduped: number; raw: number } | null => {
    const summary = summarizedInstances[className];
    if (!summary || !Array.isArray(summary)) return null;
    if (summarizing[className]) return null;
    const completeForClass = (results || []).filter(
      (r) => r.awp_class_name === className && r.status === "complete" && r.result_text,
    );
    if (completeForClass.length !== 1) return null;
    if (completeForClass[0].file_id !== fileId) return null;
    const raw = parseResultText(completeForClass[0].result_text || "").length;
    return { deduped: summary.length, raw };
  };

  const getResultsForClass = (className: string) =>
    results?.filter((r) => r.awp_class_name === className) || [];

  // ---- Early returns ----

  // Freeze the visible counter at last non-zero values during phase transitions.
  // MUST be declared before any early return to keep hook order stable.
  const lastCounterRef = useRef<{ done: number; total: number; phase: string | null }>({
    done: 0,
    total: 0,
    phase: null,
  });

  if (promptsLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (!prompts?.length) return null;

  const anyAnalyzing = analyzingClasses.size > 0;
  // Pipeline-driven state from DB
  // ---- Canonical UI state (single source of truth) ----
  const pipelinePhase = requestState.pipelinePhase;
  const rawPipelineDone = requestState.progress.done;
  const rawPipelineTotal = requestState.progress.total;
  const dbStatus = requestState.status || undefined;
  const dbErrorMessage = requestState.row?.error_message ?? null;
  const pipelineRunning = requestState.isRunning;
  const pipelinePhaseLabel = requestState.label;
  const wmsvRunning = pipelineRunning || analyzeV2Stopping;
  const wmsvPhaseLabel = analyzeV2Stopping ? "Stopping…" : pipelinePhaseLabel;

  // Track the phase that produced the last (done, total) so we never carry
  // a triage count into the analyze phase. When the phase changes but the
  // new phase hasn't written totals yet, render "…" instead of stale numbers.
  if (pipelineRunning) {
    if (rawPipelineTotal > 0) {
      lastCounterRef.current = { done: rawPipelineDone, total: rawPipelineTotal, phase: pipelinePhase };
    }
  } else {
    lastCounterRef.current = { done: 0, total: 0, phase: null };
  }
  const countersMatchPhase =
    rawPipelineTotal > 0 && lastCounterRef.current.phase === pipelinePhase;
  const pipelineDone = countersMatchPhase ? rawPipelineDone : 0;
  const pipelineTotal = countersMatchPhase ? rawPipelineTotal : 0;

  // Phase-aware unit label. Counts are per-job, not per-drawing — the triage
  // phase enqueues one job per (page × class) and the analyze phase enqueues
  // one job per (file × class) that survived triage. Using "drawings" or
  // "classes" was misleading because the totals don't match either entity
  // 1:1. "checks" reflects what's actually being counted.
  const pipelineUnit = (() => {
    switch (pipelinePhase) {
      case "splitting":
      case "extracting":
        return "pages";
      case "triaging":
        return "page checks";
      case "dispatching_analyze":
      case "analyzing":
      case "summarizing":
        return "checks";
      default:
        return "items";
    }
  })();

  // While transitioning from triage → analyze (phase=dispatching_analyze) the
  // backend has not yet written the analyze-phase totals. Suppress any stale
  // count so it doesn't read "Analyzing Content 54/54 items".
  const showCounter =
    pipelinePhase !== "dispatching_analyze" && pipelineTotal > 0;
  void triageBreakdown;


  return (
    <TooltipProvider delayDuration={0}>
      <div className="space-y-6">

        {/* ================================================================
            Drawing Analysis Grid
        ================================================================ */}
        <div className="bg-card border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center gap-3">
            {isWMSV ? (
              /* ---- WMSV simplified toolbar ---- */
              <div className="flex items-center gap-3">
                {wmsvRunning ? (
                  <div className="flex items-center gap-3">
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                    <span className="text-sm font-medium text-foreground">{wmsvPhaseLabel}</span>
                    {!analyzeV2Stopping && showCounter && (
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {pipelineDone}/{pipelineTotal} {pipelineUnit}
                      </span>
                    )}
                    {!analyzeV2Stopping && !showCounter && (
                      <span className="text-xs text-muted-foreground tabular-nums">…</span>
                    )}
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={handleWmsvStop}
                      disabled={analyzeV2Stopping}
                    >
                      <Square className="w-4 h-4 mr-2" />
                      {analyzeV2Stopping ? "Stopping…" : "Stop"}
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <select
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                      value={engineVersion}
                      onChange={(e) => setEngineVersion(e.target.value)}
                    >
                      <option value="6.8" disabled>RiskClock Engine 6.8 (Jan-2026) (deprecated)</option>
                      <option value="7.1">RiskClock Engine 7.1 (Mar-2026)</option>
                      <option value="7.2">RiskClock Engine 7.2 (Apr-2026)</option>
                      <option value="7.3-tp">RiskClock Engine 7.3 Technical Preview (May-2026)</option>
                    </select>
                    <Button
                      size="sm"
                      onClick={handleWmsvStartAnalysis}
                      disabled={copiedFiles.length === 0}
                    >
                      <Play className="w-4 h-4 mr-2" />
                      Start Analysis
                      {copiedFiles.length > 0 && (
                        <span className="ml-1 tabular-nums">
                          ({copiedFiles.length} credit{copiedFiles.length === 1 ? "" : "s"})
                        </span>
                      )}
                    </Button>
                    {copiedFiles.length > 0 && (
                      <span
                        className={`text-xs tabular-nums ${creditsBalance < copiedFiles.length ? "text-destructive font-medium" : "text-muted-foreground"}`}
                      >
                        {creditsBalance} credit{creditsBalance === 1 ? "" : "s"} available
                      </span>
                    )}
                    {isInternal && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm" variant="ghost" className="h-8 w-8 p-0">
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => startPipeline("extract")}
                            disabled={copiedFiles.length === 0}
                          >
                            <RotateCcw className="w-4 h-4 mr-2" />
                            Restart from Context Extraction
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => startPipeline("triage")}
                            disabled={copiedFiles.length === 0}
                          >
                            <RotateCcw className="w-4 h-4 mr-2" />
                            Restart from Triaging
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => startPipeline("analyze")}
                            disabled={copiedFiles.length === 0}
                          >
                            <RotateCcw className="w-4 h-4 mr-2" />
                            Restart from Deep Analysis
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                )}
              </div>
            ) : (
              /* ---- Standard toolbar ---- */
            <div className="flex items-center gap-3">
              {/* Pipeline running indicator — shown when backend pipeline is active */}
              {pipelineRunning ? (
                <div className="flex items-center gap-3">
                  <Loader2 className="w-4 h-4 animate-spin text-primary" />
                  <span className="text-sm font-medium text-foreground">{pipelinePhaseLabel}</span>
                  {showCounter ? (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {pipelineDone}/{pipelineTotal} {pipelineUnit}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground tabular-nums">…</span>
                  )}
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={handleWmsvStop}
                  >
                    <Square className="w-4 h-4 mr-2" />
                    Stop
                  </Button>
                </div>
              ) : (
                <>
              {/* Extract Context */}
              <Button
                size="sm"
                variant="outline"
                onClick={() => startPipeline("extract")}
                disabled={triageRunning || anyAnalyzing || copiedFiles.length === 0}
              >
                <FileSearch className="w-4 h-4 mr-2" />
                Extract Context
              </Button>

              <div className="h-6 w-px bg-border" />

              {/* Triage group */}
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground whitespace-nowrap">Model:</label>
                <select
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                  value={triageModel}
                  onChange={(e) => updateTriageModel(e.target.value)}
                  disabled={pipelineRunning}
                >
                  <option value="gpt-5">RiskClock Engine / OpenAI gpt-5</option>
                  <option value="gpt-5-mini">RiskClock Engine / OpenAI gpt-5-mini</option>
                  <option value="gpt-5-nano">RiskClock Engine / OpenAI gpt-5-nano</option>
                  <option value="gemini-2.5-pro">RiskClock Engine / Google gemini-2.5-pro</option>
                  <option value="gemini-2.5-flash">RiskClock Engine / Google gemini-2.5-flash</option>
                  <option value="gemini-2.5-flash-lite">RiskClock Engine / Google gemini-2.5-flash-lite</option>
                  <option value="claude-sonnet">RiskClock Engine / Anthropic claude-sonnet</option>
                  <option value="claude-haiku">RiskClock Engine / Anthropic claude-haiku</option>
                </select>
              </div>
              {!triageRunning && triageTokens > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex items-center cursor-default">
                      <Info className="w-4 h-4 text-muted-foreground" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p className="text-xs tabular-nums">Last triage used {triageTokens.toLocaleString()} tokens</p>
                  </TooltipContent>
                </Tooltip>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => startPipeline("triage")}
                disabled={anyAnalyzing || copiedFiles.length === 0}
              >
                <ScanLine className="w-4 h-4 mr-2" />
                Triage
              </Button>

              <div className="h-6 w-px bg-border" />

              {/* Analyze group */}
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground whitespace-nowrap">Model:</label>
                <select
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                  value={analyzeModel}
                  onChange={(e) => updateAnalyzeModel(e.target.value)}
                  disabled={pipelineRunning}
                >
                  <option value="gpt-5">RiskClock Engine / OpenAI gpt-5</option>
                  <option value="gpt-5-mini">RiskClock Engine / OpenAI gpt-5-mini</option>
                  <option value="gpt-5-nano">RiskClock Engine / OpenAI gpt-5-nano</option>
                  <option value="gemini-2.5-pro">RiskClock Engine / Google gemini-2.5-pro</option>
                  <option value="gemini-2.5-flash">RiskClock Engine / Google gemini-2.5-flash</option>
                  <option value="gemini-2.5-flash-lite">RiskClock Engine / Google gemini-2.5-flash-lite</option>
                  <option value="claude-sonnet">RiskClock Engine / Anthropic claude-sonnet</option>
                  <option value="claude-haiku">RiskClock Engine / Anthropic claude-haiku</option>
                </select>
              </div>
              {!analyzeV2Running && analyzeTokens > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex items-center cursor-default">
                      <Info className="w-4 h-4 text-muted-foreground" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p className="text-xs tabular-nums">Last analysis used {analyzeTokens.toLocaleString()} tokens</p>
                  </TooltipContent>
                </Tooltip>
              )}
              <div className="flex items-center gap-2">
                 <Button
                   size="sm"
                   onClick={() => startPipeline("analyze")}
                   disabled={anyAnalyzing || copiedFiles.length === 0}
                 >
                   <Search className="w-4 h-4 mr-2" />
                   Analyze
                 </Button>
                 <Separator orientation="vertical" className="h-6" />
                 <DropdownMenu>
                   <DropdownMenuTrigger asChild>
                     <Button
                       size="sm"
                       variant="outline"
                       disabled={anyAnalyzing || copiedFiles.length === 0}
                     >
                       Clear
                     </Button>
                   </DropdownMenuTrigger>
                   <DropdownMenuContent align="start">
                     <DropdownMenuItem onClick={async () => {
                       if (!requestId) return;
                       await supabase.from("analysis_triage_results").delete().eq("analysis_request_id", requestId);
                       await supabase.from("analysis_triage_overrides").delete().eq("analysis_request_id", requestId);
                       await supabase.from("analysis_results").delete().eq("analysis_request_id", requestId);
                       await supabase.from("analysis_requests").update({ summary_data: {} }).eq("id", requestId);
                       queryClient.invalidateQueries({ queryKey: ["analysis-triage-results", requestId] });
                       queryClient.invalidateQueries({ queryKey: ["analysis-results", requestId] });
                       queryClient.invalidateQueries({ queryKey: ["requestMeta", requestId] });
                       toast({ title: "Triage and analysis results cleared" });
                     }}>
                       Clear Triage Results
                     </DropdownMenuItem>
                     <DropdownMenuItem onClick={async () => {
                       if (!requestId) return;
                       await supabase.from("analysis_results").delete().eq("analysis_request_id", requestId);
                       await supabase.from("analysis_requests").update({ summary_data: {} }).eq("id", requestId);
                       queryClient.invalidateQueries({ queryKey: ["analysis-results", requestId] });
                       queryClient.invalidateQueries({ queryKey: ["requestMeta", requestId] });
                       toast({ title: "Analysis results cleared" });
                     }}>
                       Clear Analysis Results
                     </DropdownMenuItem>
                   </DropdownMenuContent>
                 </DropdownMenu>
               </div>
              </>
              )}
            </div>
            )}
          </div>

          {dbErrorMessage && !pipelineRunning && (
            <div className="px-4 py-2 bg-destructive/10 text-destructive text-sm border-b flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {dbErrorMessage}
            </div>
          )}

          {copiedFiles.length === 0 ? (
            <div className="px-4 py-6 text-sm text-muted-foreground text-center">
              No files ready for analysis.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full caption-bottom text-sm border-collapse">
                <thead>
                  {/* Header row: file info columns + class abbreviations */}
                  <tr className="border-b">
                    <th className="sticky left-0 z-10 bg-card px-4 py-2 text-left font-medium text-muted-foreground min-w-[180px] max-w-[320px] w-auto border-r">
                      <span className="block text-sm">
                        Files ({copiedFiles.length} files | {formatBytes(totalSizeBytes)})
                      </span>
                    </th>
                     {sortedPrompts.map((prompt) => {
                      const isDisabled = disabledColumns.has(prompt.awp_class_name);
                      const isComingSoon = DEFAULT_DISABLED_AWP.has(prompt.awp_class_name);
                      return (
                      <th key={prompt.id} className={`w-14 px-2 py-2 text-center font-medium text-muted-foreground ${isDisabled ? 'opacity-30' : ''}`}>
                        <div className="flex flex-col items-center gap-1">
                            {isComingSoon ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex">
                                    <Checkbox
                                      checked={false}
                                      disabled
                                      className="h-3.5 w-3.5 cursor-not-allowed"
                                    />
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>Coming soon</TooltipContent>
                              </Tooltip>
                            ) : (
                              <Checkbox
                                checked={!isDisabled}
                                onCheckedChange={() => toggleColumnDisabled(prompt.awp_class_name)}
                                className="h-3.5 w-3.5"
                              />
                            )}
                          <Tooltip>
                            <TooltipTrigger asChild>
                              {prompt.drive_file_url && !isWMSV ? (
                                <a
                                  href={prompt.drive_file_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="font-mono text-xs text-primary underline underline-offset-2 hover:text-primary/80"
                                >
                                  {getPrefix(prompt.awp_class_name)}
                                </a>
                              ) : (
                                <span className="cursor-default font-mono text-xs">
                                  {getPrefix(prompt.awp_class_name)}
                                </span>
                              )}
                            </TooltipTrigger>
                            <TooltipContent>{isComingSoon ? "Coming soon" : prompt.awp_class_name}</TooltipContent>
                          </Tooltip>
                        </div>
                      </th>
                      );
                    })}
                  </tr>

                  {/* Button sub-row: per-column analyze/stop controls */}
                  <tr className="border-b bg-muted/20">
                     <td className="sticky left-0 z-10 bg-muted/20 px-4 py-1.5 border-r min-w-[180px] max-w-[320px] w-auto">
                       {isWMSV && onAddFileUpload ? (
                         <div className="flex items-center gap-2 flex-wrap">
                           <span className="text-xs text-muted-foreground whitespace-nowrap">Add more files:</span>
                           <Button size="sm" variant="outline" className="h-6 text-xs gap-1" onClick={onAddFileUpload}>
                             <Upload className="w-3 h-3" />
                             Upload Files
                           </Button>
                           <Button size="sm" variant="outline" className="h-6 text-xs gap-1" onClick={onAddFileDrive}>
                             <img src="/icons/icon_googledrive.png" className="w-3 h-3" alt="" />
                             Google Drive
                           </Button>
                           <Button size="sm" variant="outline" className="h-6 text-xs gap-1" onClick={onAddFileProcore}>
                             <img src="/icons/icon_procore.png" className="w-3 h-3" alt="" />
                             Procore
                           </Button>
                           <Button size="sm" variant="outline" className="h-6 text-xs gap-1" onClick={onAddFileSharePoint}>
                             <img src="/icons/icon_sharepoint.png" className="w-3 h-3" alt="" />
                             SharePoint
                           </Button>
                         </div>
                       ) : (
                         <Button size="sm" variant="outline" className="h-6 text-xs gap-1" onClick={handleDownloadZip}>
                           <Download className="w-3 h-3" />
                           Download ZIP
                         </Button>
                       )}
                     </td>
                    
                     {sortedPrompts.map((prompt) => {
                       const className = prompt.awp_class_name;
                        const isDisabled = disabledColumns.has(className);
                        const hasTriageResults = copiedFiles.some((f) => triageResults.has(`${f.id}_${className}`));

                        return (
                          <td key={prompt.id} className={`w-14 px-2 py-1.5 text-center ${isDisabled ? 'opacity-30' : ''}`}>
                            {triagingClasses.has(className) && !isDisabled ? (
                              <div className="flex items-center justify-center">
                                <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                              </div>
                            ) : isInternal ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-6 w-6"
                                    disabled={copiedFiles.length === 0 || isDisabled || triageRunning}
                                    onClick={() => handleTriageClass(prompt)}
                                  >
                                    {hasTriageResults ? (
                                      <RotateCcw className="w-3 h-3" />
                                    ) : (
                                      <ScanLine className="w-3 h-3" />
                                    )}
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {isDisabled ? `${className} is disabled` : hasTriageResults ? `Re-triage ${className}` : `Triage ${className}`}
                                </TooltipContent>
                              </Tooltip>
                            ) : null}
                         </td>
                       );
                     })}
                  </tr>
                </thead>

                <tbody>
                  {copiedFiles.map((file) => (
                    <tr key={file.id} className="border-b hover:bg-muted/30 transition-colors">
                      {/* File name (sticky) */}
                      <td className="sticky left-0 z-10 bg-card hover:bg-muted/30 px-4 py-2 border-r min-w-[180px] max-w-[320px] w-auto">
                        <div className="flex items-center gap-2 min-w-0">
                          <button
                            className="text-sm font-medium truncate flex-1 min-w-0 text-primary hover:underline text-left"
                            onClick={() => setPreviewFile(file)}
                          >
                            {file.name}
                          </button>
                          {(() => {
                            const sp = sheetProgressByFile.get(file.id);
                            // Once the pipeline has advanced past extract, every
                            // file present in the run must have completed extraction —
                            // stale per-sheet `pending` counts should not keep the
                            // spinner alive.
                            const pastExtract =
                              pipelinePhase === "triaging" ||
                              pipelinePhase === "dispatching_analyze" ||
                              pipelinePhase === "analyzing" ||
                              pipelinePhase === "summarizing" ||
                              dbStatus === "complete";
                            // Sheet-mode: spinner if any sheet of this file is still pending
                            const sheetExtracting = !pastExtract && !!sp && sp.pending > 0;
                            // Sheet-mode: processed when ALL sheets are extracted
                            const sheetAllDone = !!sp && sp.total > 0 && sp.pending === 0;
                            // Legacy fallback (non-sheet-mode runs)
                            const legacyExtracting = !pastExtract && extractingFileIds.has(file.id);
                            const legacyExtracted = extractedFileIds.has(file.id);
                            // Pipeline-phase fallback: while phase is extract/split, show spinner
                            // for any file not yet marked processed.
                            const pipelineExtracting =
                              (pipelinePhase === "extracting" || pipelinePhase === "splitting") &&
                              !legacyExtracted && !sheetAllDone;
                            const showSpinner = sheetExtracting || legacyExtracting || pipelineExtracting;
                            const showProcessed =
                              !showSpinner && (sheetAllDone || legacyExtracted || pastExtract);
                            return (
                              <>
                                {showSpinner && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Loader2 className="w-3 h-3 animate-spin text-muted-foreground flex-shrink-0" />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      {sp
                                        ? `Extracting context: ${sp.total - sp.pending}/${sp.total} pages`
                                        : "Extracting context"}
                                    </TooltipContent>
                                  </Tooltip>
                                )}
                                {uploadingFileIds.has(file.id) && !showSpinner && pipelinePhase !== "analyzing" && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground flex-shrink-0">
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                        Uploading
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent>Uploading file to analysis service</TooltipContent>
                                  </Tooltip>
                                )}
                                {showProcessed && (
                                  <button
                                    className="inline-flex items-center rounded-full border border-emerald-300 bg-emerald-100 px-1.5 py-px text-[10px] font-medium text-emerald-800 leading-tight flex-shrink-0 cursor-pointer hover:bg-emerald-200 transition-colors"
                                    onClick={() => setExtractedTextFile(file)}
                                  >
                                    Processed
                                  </button>
                                )}
                              </>
                            );
                          })()}
                          {!pipelineRunning && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 flex-shrink-0 text-muted-foreground hover:text-destructive"
                                  onClick={() => setFileToDelete(file)}
                                  disabled={deletingFileId === file.id}
                                  aria-label={`Remove ${file.name}`}
                                >
                                  {deletingFileId === file.id ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <X className="w-3.5 h-3.5" />
                                  )}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Remove this file</TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </td>


                       {/* Per-class cells */}
                       {sortedPrompts.map((prompt) => {
                        const val = countForCell(file.id, prompt.awp_class_name);
                        const className = prompt.awp_class_name;
                        const isColDisabled = disabledColumns.has(className);
                        const disabledCls = isColDisabled ? ' opacity-30 pointer-events-none' : '';

                        // Helper: look up triage background for pass-2 cells
                        const triageForBg = triageResults.get(`${file.id}_${className}`);
                        const triageBgStyle: React.CSSProperties = triageForBg?.status === 'complete' && triageForBg.score !== null
                          ? { backgroundColor: `rgba(34, 197, 94, ${Math.max(0.15, Math.min(1, triageForBg.score / 100))})` }
                          : {};

                        if (val === "loading") {
                          return (
                            <td key={prompt.id} className={`w-14 px-2 py-2 text-center${disabledCls}`} style={triageBgStyle}>
                              <Loader2 className="w-3 h-3 animate-spin text-muted-foreground mx-auto" />
                            </td>
                          );
                        }

                        if (val === "failed") {
                          return (
                            <td key={prompt.id} className={`w-14 px-2 py-2 text-center${disabledCls}`} style={triageBgStyle}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span>
                                    <AlertTriangle className="w-3.5 h-3.5 text-destructive mx-auto" />
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>Analysis failed for this file</TooltipContent>
                              </Tooltip>
                            </td>
                          );
                        }

                        if (typeof val === "number" && val > 0) {
                          // Clickable count — open RawResultModal
                          const result = results?.find(
                            (r) => r.file_id === file.id && r.awp_class_name === className && r.status === "complete" && r.result_text
                          );
                          const dedup = dedupedCountForCell(file.id, className);
                          const display = dedup ? dedup.deduped : val;
                          const showDedupTooltip = !!dedup && dedup.deduped !== dedup.raw;
                          const button = (
                            <button
                              className="text-sm font-semibold text-white hover:underline"
                              onClick={() => {
                                if (result?.result_text) {
                                  setRawResultModal({
                                    fileName: file.name,
                                    awpClassName: className,
                                    resultText: result.result_text,
                                    instanceCount: val,
                                    sourceFile: file,
                                  });
                                }
                              }}
                            >
                              {display}
                            </button>
                          );
                          return (
                            <td key={prompt.id} className={`w-14 px-2 py-2 text-center${disabledCls}`} style={triageBgStyle}>
                              {showDedupTooltip ? (
                                <Tooltip>
                                  <TooltipTrigger asChild><span>{button}</span></TooltipTrigger>
                                  <TooltipContent>
                                    {dedup!.deduped} unique room{dedup!.deduped === 1 ? "" : "s"} · {dedup!.raw} raw mention{dedup!.raw === 1 ? "" : "s"}
                                  </TooltipContent>
                                </Tooltip>
                              ) : button}
                            </td>
                          );
                        }

                        if (typeof val === "number" && val === 0) {
                          const result0 = results?.find(
                            (r) => r.file_id === file.id && r.awp_class_name === className && r.status === "complete" && r.result_text
                          );
                          return (
                            <td key={prompt.id} className={`w-14 px-2 py-2 text-center${disabledCls}`} style={triageBgStyle}>
                              {result0?.result_text ? (
                                <button
                                  className="text-sm text-muted-foreground hover:text-foreground hover:underline cursor-pointer"
                                  onClick={() => {
                                    setRawResultModal({
                                      fileName: file.name,
                                      awpClassName: className,
                                      resultText: result0.result_text!,
                                      instanceCount: 0,
                                      sourceFile: file,
                                    });
                                  }}
                                >
                                  0
                                </button>
                              ) : (
                                <span className="text-sm text-muted-foreground">0</span>
                              )}
                            </td>
                          );
                        }

                        // null — not yet analyzed; check for triage result
                        const triageKey = `${file.id}_${prompt.awp_class_name}`;
                        const triage = triageResults.get(triageKey);

                        if (triage?.status === "queued" || triage?.status === "pending" || triage?.status === "processing") {
                          return (
                            <td key={prompt.id} className={`w-14 px-2 py-2 text-center${disabledCls}`}>
                              <Loader2 className="w-3 h-3 animate-spin text-muted-foreground mx-auto" />
                            </td>
                          );
                        }

                        if (triage?.status === "complete" && triage.score !== null) {
                          const overrideKey = `${file.id}_${prompt.awp_class_name}`;
                          const override = triageOverrides.get(overrideKey);
                          const autoIncluded = triage.score >= 80;

                          // Determine visual style based on override state
                          let cellStyle: React.CSSProperties = {};
                          const isAnalyzingPhase = pipelinePhase === "analyzing";
                          let cellClass = `w-14 px-2 py-2 text-center ${isAnalyzingPhase ? 'cursor-default' : 'cursor-pointer'} transition-colors${disabledCls}`;
                          let overrideLabel = "";

                          // Always show triage score background on the cell, with opacity floor.
                          const opacity = Math.max(0.15, Math.min(1, triage.score / 100));
                          cellStyle = { backgroundColor: `rgba(34, 197, 94, ${opacity})` };

                          if (override === "exclude") {
                            overrideLabel = " (Manually excluded)";
                          } else if (override === "include") {
                            overrideLabel = " (Manually included)";
                          }

                          return (
                            <td
                              key={prompt.id}
                              className={`${cellClass} relative`}
                              style={cellStyle}
                              onClick={() => handleTriageCellClick(file.id, prompt.awp_class_name, triage.score!)}
                            >
                              {override === "exclude" && (
                                <div className="absolute inset-0 flex items-center justify-center p-[10%]">
                                  <div className="w-full h-full bg-white/90" />
                                </div>
                              )}
                              {override === "include" && (
                                <div className="absolute inset-0 flex items-center justify-center p-[10%]">
                                  <div className="w-full h-full bg-green-500/90" />
                                </div>
                              )}
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="block w-full h-full relative z-10 flex items-center justify-center">
                                    <span>&nbsp;</span>
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs whitespace-pre-wrap text-left">
                                  <div className="font-medium">{triage.score}%</div>
                                  <div className="mt-1">{triage.reason || "No reason"}</div>
                                  {overrideLabel && <div className="mt-1 text-muted-foreground">{overrideLabel}</div>}
                                </TooltipContent>
                              </Tooltip>
                            </td>
                          );
                        }

                        if (triage?.status === "failed") {
                          return (
                            <td key={prompt.id} className={`w-14 px-2 py-2 text-center${disabledCls}`}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span>
                                    <AlertTriangle className="w-3.5 h-3.5 text-yellow-500 mx-auto" />
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>Triage failed</TooltipContent>
                              </Tooltip>
                            </td>
                          );
                        }

                        // Queued fallback: while the pipeline is mid-flight
                        // (triage running, transitioning to analyze, or
                        // analyzing) and this enabled cell has no triage
                        // row and no analyze result yet, show a faint spinner
                        // so the cell doesn't appear "done" prematurely.
                        const inFlightPhase =
                          pipelinePhase === "triaging" ||
                          pipelinePhase === "dispatching_analyze" ||
                          pipelinePhase === "analyzing";
                        if (inFlightPhase && !isColDisabled && val === null) {
                          return (
                            <td key={prompt.id} className={`w-14 px-2 py-2 text-center${disabledCls}`}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Loader2 className="w-3 h-3 animate-spin text-muted-foreground/60 mx-auto" />
                                </TooltipTrigger>
                                <TooltipContent>Queued</TooltipContent>
                              </Tooltip>
                            </td>
                          );
                        }

                        return <td key={prompt.id} className="w-14 px-2 py-2" />;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ================================================================
            Analysis Summary — Unified Single Card
        ================================================================ */}
        <div className="bg-card border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary" />
              <h2 className="text-base font-semibold">Analysis Summary</h2>
              {isInternal && (
                <Button
                  size="sm"
                  variant={summaryRunning ? "destructive" : "outline"}
                  className="h-7 text-xs ml-2"
                  onClick={handleSummarizeAll}
                >
                  {summaryRunning ? (
                    <>
                      <Square className="w-3 h-3 mr-1" />
                      Stop
                    </>
                  ) : (
                    <>
                      <Play className="w-3 h-3 mr-1" />
                      Summarize Analysis Results
                    </>
                  )}
                </Button>
              )}
            </div>
            {!isWMSV && (
              <div className="flex items-center gap-1">
                <Button size="sm" variant={summaryGroupBy === "awp" ? "default" : "outline"} onClick={() => setSummaryGroupBy("awp")} className="h-7 text-xs">By AWP</Button>
                <Button size="sm" variant={summaryGroupBy === "floor" ? "default" : "outline"} onClick={() => setSummaryGroupBy("floor")} className="h-7 text-xs">By Floor</Button>
              </div>
            )}
          </div>

          <div className="divide-y">
            {summaryGroupBy === "awp" ? (
              sortedPrompts.map((prompt) => {
                const cn2 = prompt.awp_class_name;
                const prefix = getPrefix(cn2);
                const isSummarizing = summarizing[cn2];
                const summary = summarizedInstances[cn2];
                const isAdding = addingToProject[cn2];
                const isAdded = addedToProject[cn2];

                return (
                  <div key={prompt.id}>
                    <div className="px-4 py-2.5 flex items-center justify-between bg-muted/20">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{cn2}</span>
                        <span className="text-xs text-muted-foreground font-mono">({prefix})</span>
                        {isSummarizing && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
                      </div>
                      {!isWMSV && summary && summary.length > 0 && (
                        <Button size="sm" variant={isAdded ? "outline" : "default"} onClick={() => handleAddToProject(cn2)} disabled={isAdding || isAdded}>
                          {isAdding ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PlusCircle className="w-4 h-4 mr-2" />}
                          {isAdded ? "Added" : "Add to Project"}
                        </Button>
                      )}
                    </div>
                    {!summary && !isSummarizing && <div className="px-4 py-3 text-sm text-muted-foreground">— Not yet analyzed</div>}
                    {isSummarizing && !summary && <div className="px-4 py-3 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Summarizing…</div>}
                    {summary && summary.length === 0 && <div className="px-4 py-3 text-sm text-muted-foreground">None identified</div>}
                    {summary && summary.length > 0 && (
                      <Table className="table-fixed w-full">
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[25%]">Display ID</TableHead>
                            <TableHead className="w-[30%]">Name</TableHead>
                            <TableHead className="w-[20%]">Floor</TableHead>
                            <TableHead className="w-[15%] text-right">Area (sqft)</TableHead>
                            <TableHead className="w-[10%]" />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {summary.map((inst, idx) => (
                            <TableRow key={idx}>
                              <TableCell className="font-mono text-sm">{inst.id}</TableCell>
                              <TableCell className="text-sm">{inst.name}</TableCell>
                              <TableCell className="text-sm">{inst.floor}</TableCell>
                              <TableCell className="text-sm text-right text-muted-foreground">{inst.area_sqft > 0 ? inst.area_sqft : "—"}</TableCell>
                              <TableCell className="text-right py-1">
                                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setSelectedInstance({ instance: inst, awpClassName: cn2 })}>
                                  <Eye className="w-4 h-4" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </div>
                );
              })
            ) : (
              /* Group by Floor */
              (() => {
                const floorMap = new Map<string, Array<SummarizedInstance & { awpClassName: string }>>();
                for (const prompt of sortedPrompts) {
                  const cn2 = prompt.awp_class_name;
                  const summary = summarizedInstances[cn2];
                  if (!summary) continue;
                  for (const inst of summary) {
                    const floor = inst.floor || "Unknown";
                    if (!floorMap.has(floor)) floorMap.set(floor, []);
                    floorMap.get(floor)!.push({ ...inst, awpClassName: cn2 });
                  }
                }
                const floors = Array.from(floorMap.keys()).sort((a, b) => {
                  // Extract numeric floor number for natural sorting (lowest to highest)
                  const numA = a.match(/(\d+)/);
                  const numB = b.match(/(\d+)/);
                  if (numA && numB) return parseInt(numA[1]) - parseInt(numB[1]);
                  // "Ground" / "Basement" etc. sort before numbered floors
                  if (numA) return 1;
                  if (numB) return -1;
                  return a.localeCompare(b);
                });
                if (floors.length === 0) {
                  return <div className="px-4 py-3 text-sm text-muted-foreground">No summarized data yet.</div>;
                }
                return floors.map((floor) => (
                  <div key={floor}>
                    <div className="px-4 py-2.5 bg-muted/20">
                      <span className="text-sm font-medium">{floor}</span>
                      <span className="text-xs text-muted-foreground ml-2">({floorMap.get(floor)!.length} items)</span>
                    </div>
                    <Table className="table-fixed w-full">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[25%]">Display ID</TableHead>
                          <TableHead className="w-[15%]">Type</TableHead>
                          <TableHead className="w-[30%]">Name</TableHead>
                          <TableHead className="w-[20%] text-right">Area (sqft)</TableHead>
                          <TableHead className="w-[10%]" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {floorMap.get(floor)!.map((inst, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="font-mono text-sm">{inst.id}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{getPrefix(inst.awpClassName)}</TableCell>
                            <TableCell className="text-sm">{inst.name}</TableCell>
                            <TableCell className="text-sm text-right text-muted-foreground">{inst.area_sqft > 0 ? inst.area_sqft : "—"}</TableCell>
                            <TableCell className="text-right py-1">
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setSelectedInstance({ instance: inst, awpClassName: inst.awpClassName })}>
                                <Eye className="w-4 h-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ));
              })()
            )}
          </div>
        </div>
      </div>

      {/* FilePreviewModal */}
      {previewFile && (
        <FilePreviewModal
          file={previewFile}
          sourceType={sourceType}
          onClose={() => setPreviewFile(null)}
        />
      )}

      {/* Extracted Text Modal */}
      {extractedTextFile && (
        <Dialog open={true} onOpenChange={() => setExtractedTextFile(null)}>
          <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
            <DialogHeader>
              <DialogTitle className="text-sm font-semibold truncate">
                Extracted Text — {extractedTextFile.name}
              </DialogTitle>
            </DialogHeader>
            <ExtractedTextBody fileId={extractedTextFile.id} localText={extractedTexts.get(extractedTextFile.id)} />
          </DialogContent>
        </Dialog>
      )}

      {/* RawResultModal */}
      {rawResultModal && (
        <RawResultModal
          fileName={rawResultModal.fileName}
          awpClassName={rawResultModal.awpClassName}
          resultText={rawResultModal.resultText}
          instanceCount={rawResultModal.instanceCount}
          sourceFile={rawResultModal.sourceFile}
          sourceType={sourceType}
          onClose={() => setRawResultModal(null)}
        />
      )}

      {/* Instance Detail Modal */}
      {selectedInstance && (() => {
        const { instance, awpClassName } = selectedInstance;
        const classResults = getResultsForClass(awpClassName);
        // Find the specific file whose result_text contains this instance id or name.
        // Use per-file result text (not combined) so bbox parser matches the correct row.
        const sourceResult =
          classResults.find((r) => r.result_text && r.status === "complete" && r.result_text.includes(instance.id)) ||
          classResults.find((r) => r.result_text && r.status === "complete" && r.result_text.includes(instance.name)) ||
          classResults.find((r) => r.status === "complete" && r.result_text);
        const sourceFile = files.find((f) => f.id === sourceResult?.file_id);
        console.log(`[BBox] opening modal: instance.id=${instance.id} instance.name=${instance.name} sourceFile=${sourceFile?.name} sourceResult file_id=${sourceResult?.file_id}`);
        return (
          <InstanceDetailModal
            instance={instance}
            awpClassName={awpClassName}
            sourceFile={sourceFile}
            resultText={sourceResult?.result_text || undefined}
            sourceType={sourceType}
            onClose={() => setSelectedInstance(null)}
          />
        );
      })()}

      {/* Buy Credits modal — opened when user runs out of credits */}
      <BuyCreditsModal
        open={buyCreditsOpen}
        onOpenChange={setBuyCreditsOpen}
        reason={buyCreditsReason}
      />

      {/* Confirm delete file */}
      <AlertDialog open={!!fileToDelete} onOpenChange={(o) => { if (!o) setFileToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this file?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="block">
                <span className="font-medium text-foreground">{fileToDelete?.name}</span>
              </span>
              <span className="block mt-2">
                This will delete the file and any analysis results tied to it. This can't be undone.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!deletingFileId}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); if (fileToDelete) handleDeleteFile(fileToDelete); }}
              disabled={!!deletingFileId}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingFileId ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Removing…</>
              ) : (
                <><Trash2 className="w-4 h-4 mr-2" />Remove file</>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  );
}
