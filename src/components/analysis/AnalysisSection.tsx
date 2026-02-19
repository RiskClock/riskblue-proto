import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
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
  Sparkles,
  PlusCircle,
  Eye,
  RotateCcw,
  AlertTriangle,
  Download,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";

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
}

interface AWPPrompt {
  id: string;
  awp_class_name: string;
  category: string;
  drive_file_id: string | null;
  drive_file_name: string | null;
  drive_file_url: string | null;
}

interface AnalysisResult {
  id: string;
  file_id: string;
  awp_class_name: string;
  result_text: string | null;
  status: string;
  error_message: string | null;
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
}

interface AnalysisSectionProps {
  requestId: string;
  files: AnalysisFile[];
  projectId: string;
  sourceType?: string;
}

// ---------------------------------------------------------------------------
// Helpers for bounding-box parsing
// ---------------------------------------------------------------------------

// Returns raw pixel coordinates in the AI's 1024×768 coordinate space
// searchTerms: array of strings to try matching against row cells (tried in order)
function parseCoordinatesFromResult(
  resultText: string,
  searchTerms: string[]
): { x1: number; y1: number; x2: number; y2: number; pageNum: number } | null {
  try {
    const lines = resultText.split("\n").filter((l) => l.includes("|"));
    if (lines.length < 2) return null;

    const headerLine = lines.find((l) => {
      const low = l.toLowerCase();
      return (
        low.includes("bounding") ||
        low.includes("bbox") ||
        low.includes("box") ||
        low.includes("coord")
      );
    });
    if (!headerLine) return null;

    const headerIdx = lines.indexOf(headerLine);
    const headers = headerLine.split("|").map((c) => c.trim().toLowerCase());
    const coordCol = headers.findIndex(
      (h) => h.includes("bounding") || h.includes("bbox") || h.includes("box") || h.includes("coord")
    );
    const pageCol = headers.findIndex((h) => h.includes("page") || h.includes("sheet"));
    if (coordCol === -1) return null;

    const dataLines = lines.slice(headerIdx + 1).filter((l) => !l.match(/^[\s|:-]+$/));

    // Find a row that matches any of the search terms
    const validTerms = searchTerms.filter(Boolean);
    let dataRow = dataLines.find((l) => {
      const cells = l.split("|").map((c) => c.trim());
      return validTerms.some((term) =>
        cells.some((c) => c.includes(term) || term.includes(c))
      );
    });
    // Fallback: first data row that contains a bounding box coordinate
    if (!dataRow) {
      dataRow = dataLines.find((l) => /\(\s*\d+/.test(l));
    }
    if (!dataRow) return null;

    const cells = dataRow.split("|").map((c) => c.trim());
    const coordCell = cells[coordCol] || "";

    // Parse (x_min, y_min, x_max, y_max) four-number format
    const fourMatch = coordCell.match(
      /\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/
    );
    // Range format: x1,y1 - x2,y2
    const rangeMatch = coordCell.match(
      /(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*(?:–|-|to)\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i
    );
    // Single point format: (x, y)
    const pointMatch = coordCell.match(/\(?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)?/);

    let pageNum = 1;
    if (pageCol !== -1) {
      const pv = parseInt(cells[pageCol] || "1", 10);
      if (!isNaN(pv) && pv > 0) pageNum = pv;
    }

    if (fourMatch) {
      const x1 = parseFloat(fourMatch[1]);
      const y1 = parseFloat(fourMatch[2]);
      const x2 = parseFloat(fourMatch[3]);
      const y2 = parseFloat(fourMatch[4]);
      return { x1: Math.min(x1, x2), y1: Math.min(y1, y2), x2: Math.max(x1, x2), y2: Math.max(y1, y2), pageNum };
    }

    if (rangeMatch) {
      const x1 = parseFloat(rangeMatch[1]);
      const y1 = parseFloat(rangeMatch[2]);
      const x2 = parseFloat(rangeMatch[3]);
      const y2 = parseFloat(rangeMatch[4]);
      return { x1: Math.min(x1, x2), y1: Math.min(y1, y2), x2: Math.max(x1, x2), y2: Math.max(y1, y2), pageNum };
    }

    if (pointMatch) {
      const cx = parseFloat(pointMatch[1]);
      const cy = parseFloat(pointMatch[2]);
      // Create a small box around the point (50px radius in AI space)
      return { x1: cx - 50, y1: cy - 50, x2: cx + 50, y2: cy + 50, pageNum };
    }

    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// InstanceDetailModal sub-component (unchanged)
// ---------------------------------------------------------------------------

interface InstanceDetailModalProps {
  instance: SummarizedInstance;
  awpClassName: string;
  sourceFile: AnalysisFile | undefined;
  resultText: string | undefined;
  onClose: () => void;
}

function InstanceDetailModal({
  instance,
  awpClassName,
  sourceFile,
  resultText,
  onClose,
}: InstanceDetailModalProps) {
  const [pageImage, setPageImage] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [baseDimensions, setBaseDimensions] = useState<{ width: number; height: number } | null>(null);
  const [rawCoords, setRawCoords] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [isLoadingPdf, setIsLoadingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfViewport, setPdfViewport] = useState<pdfjsLib.PageViewport | null>(null);
  const [offscreenSize, setOffscreenSize] = useState<{ w: number; h: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Step 1: Download PDF → render to offscreen canvas at scale 4 → convert to HTMLImageElement
  useEffect(() => {
    if (!sourceFile?.storage_path) return;
    setIsLoadingPdf(true);
    setPdfError(null);
    setPageImage(null);
    setRawCoords(null);
    setBaseDimensions(null);
    setPdfViewport(null);
    setOffscreenSize(null);
    setZoom(1);

    let cancelled = false;

    (async () => {
      try {
        const { data: blob, error: dlErr } = await supabase.storage
          .from("drive-analysis-files")
          .download(sourceFile.storage_path!);
        if (dlErr || !blob) throw dlErr || new Error("Download failed");
        const ab = await blob.arrayBuffer();
        if (cancelled) return;

        // Build search terms from instance id and name fragments
        const planCodeMatch = instance.name?.match(/\b([A-Z]+-B?\d+)\b/);
        const planCode = planCodeMatch?.[1];
        const searchTerms = [instance.id, instance.name, planCode].filter(Boolean) as string[];

        // Parse bounding box
        if (resultText) {
          const coords = parseCoordinatesFromResult(resultText, searchTerms);
          if (coords) setRawCoords({ x1: coords.x1, y1: coords.y1, x2: coords.x2, y2: coords.y2 });
        }

        const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
        if (cancelled) return;

        const coords = resultText ? parseCoordinatesFromResult(resultText, searchTerms) : null;
        const targetPage = coords?.pageNum ?? 1;
        const page = await pdf.getPage(Math.min(targetPage, pdf.numPages));
        if (cancelled) return;

        // Render at high resolution (scale 4) to offscreen canvas
        const viewport = page.getViewport({ scale: 4 });
        setPdfViewport(viewport);
        setOffscreenSize({ w: viewport.width, h: viewport.height });
        const offscreen = document.createElement("canvas");
        offscreen.width = viewport.width;
        offscreen.height = viewport.height;
        const ctx = offscreen.getContext("2d")!;
        await page.render({ canvasContext: ctx, viewport, canvas: offscreen } as any).promise;
        if (cancelled) return;

        // Convert to HTMLImageElement
        const img = new Image();
        img.src = offscreen.toDataURL();
        await new Promise<void>((resolve) => { img.onload = () => resolve(); });
        if (cancelled) return;

        setPageImage(img);
      } catch (e) {
        if (!cancelled) {
          console.error("PDF render error:", e);
          setPdfError("Failed to render drawing.");
        }
      } finally {
        if (!cancelled) setIsLoadingPdf(false);
      }
    })();

    return () => { cancelled = true; };
  }, [sourceFile?.storage_path, instance.id, resultText]);

  // Step 2: Compute base dimensions when image loads (fit to container) — exact LocationDetailsModal pattern
  useEffect(() => {
    if (!pageImage || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const containerW = rect.width - 32;
    const containerH = rect.height - 32;
    if (containerW <= 0 || containerH <= 0) return;
    const imgAspect = pageImage.naturalWidth / pageImage.naturalHeight;
    const containerAspect = containerW / containerH;
    let baseW: number, baseH: number;
    if (imgAspect > containerAspect) {
      baseW = containerW;
      baseH = containerW / imgAspect;
    } else {
      baseH = containerH;
      baseW = containerH * imgAspect;
    }
    setBaseDimensions({ width: baseW, height: baseH });
    setZoom(1);
  }, [pageImage]);

  // Step 3: Draw image + red bounding box overlay onto display canvas
  useEffect(() => {
    if (!pageImage || !baseDimensions || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const w = Math.floor(baseDimensions.width * zoom);
    const h = Math.floor(baseDimensions.height * zoom);
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(pageImage, 0, 0, w, h);

    if (rawCoords && pdfViewport && offscreenSize) {
      // Convert PDF user-space (pts, origin bottom-left) → offscreen canvas pixels.
      // convertToViewportRectangle handles Y-axis flip and scale in one step.
      const [vx1, vy1, vx2, vy2] = pdfViewport.convertToViewportRectangle([
        rawCoords.x1, rawCoords.y1, rawCoords.x2, rawCoords.y2,
      ]);
      // Normalize to [0..1] using offscreen canvas size, then map to display canvas
      const nx1 = Math.min(vx1, vx2) / offscreenSize.w;
      const ny1 = Math.min(vy1, vy2) / offscreenSize.h;
      const nx2 = Math.max(vx1, vx2) / offscreenSize.w;
      const ny2 = Math.max(vy1, vy2) / offscreenSize.h;
      const bx = nx1 * w;
      const by = ny1 * h;
      const bw = (nx2 - nx1) * w;
      const bh = (ny2 - ny1) * h;
      ctx.fillStyle = "rgba(239, 68, 68, 0.15)";
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = "rgba(239, 68, 68, 0.9)";
      ctx.lineWidth = 2.5;
      ctx.strokeRect(bx, by, bw, bh);
    }
  }, [pageImage, baseDimensions, zoom, rawCoords, pdfViewport, offscreenSize]);

  // Center-preserving zoom handlers — exact copy from LocationDetailsModal
  const handleZoomIn = () => {
    const container = containerRef.current;
    if (!container) { setZoom(z => Math.min(4, z + 0.25)); return; }
    const scrollCenterX = container.scrollWidth > 0
      ? (container.scrollLeft + container.clientWidth / 2) / container.scrollWidth : 0.5;
    const scrollCenterY = container.scrollHeight > 0
      ? (container.scrollTop + container.clientHeight / 2) / container.scrollHeight : 0.5;
    setZoom(prevZoom => {
      const newZoom = Math.min(4, prevZoom + 0.25);
      requestAnimationFrame(() => {
        container.scrollLeft = scrollCenterX * container.scrollWidth - container.clientWidth / 2;
        container.scrollTop = scrollCenterY * container.scrollHeight - container.clientHeight / 2;
      });
      return newZoom;
    });
  };

  const handleZoomOut = () => {
    const container = containerRef.current;
    if (!container) { setZoom(z => Math.max(0.5, z - 0.25)); return; }
    const scrollCenterX = container.scrollWidth > 0
      ? (container.scrollLeft + container.clientWidth / 2) / container.scrollWidth : 0.5;
    const scrollCenterY = container.scrollHeight > 0
      ? (container.scrollTop + container.clientHeight / 2) / container.scrollHeight : 0.5;
    setZoom(prevZoom => {
      const newZoom = Math.max(0.5, prevZoom - 0.25);
      requestAnimationFrame(() => {
        container.scrollLeft = scrollCenterX * container.scrollWidth - container.clientWidth / 2;
        container.scrollTop = scrollCenterY * container.scrollHeight - container.clientHeight / 2;
      });
      return newZoom;
    });
  };

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
              {rawCoords ? (
                <p className="text-xs font-mono text-muted-foreground leading-relaxed">
                  ({Math.round(rawCoords.x1)}, {Math.round(rawCoords.y1)})<br />
                  → ({Math.round(rawCoords.x2)}, {Math.round(rawCoords.y2)})
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

          {/* Right: drawing area with fixed toolbar + scrollable canvas */}
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
            {/* Fixed zoom toolbar */}
            <div className="h-12 flex-shrink-0 flex items-center justify-between px-4 border-b bg-background">
              <span className="text-sm text-muted-foreground">Drawing Preview</span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={handleZoomOut} disabled={zoom <= 0.5}>
                  <ZoomOut className="w-4 h-4" />
                </Button>
                <span className="text-sm min-w-[3rem] text-center tabular-nums">{Math.round(zoom * 100)}%</span>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={handleZoomIn} disabled={zoom >= 4}>
                  <ZoomIn className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* Scrollable drawing container */}
            <div
              ref={containerRef}
              className="flex-1 min-h-0 overflow-auto bg-muted/30 m-4 border rounded-lg p-4"
            >
              {!sourceFile?.storage_path ? (
                <div className="flex items-center justify-center h-full">
                  <p className="text-sm text-muted-foreground">Drawing not available</p>
                </div>
              ) : pdfError ? (
                <div className="flex items-center justify-center h-full">
                  <p className="text-sm text-destructive">{pdfError}</p>
                </div>
              ) : isLoadingPdf ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="flex items-start justify-start min-h-full min-w-full">
                  <canvas ref={canvasRef} className="rounded shadow-sm" style={{ maxWidth: "none", maxHeight: "none" }} />
                </div>
              )}
            </div>
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
  onClose: () => void;
}

function RawResultModal({ fileName, awpClassName, resultText, instanceCount, onClose }: RawResultModalProps) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm truncate">{fileName}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground mb-2">
          {awpClassName} — {instanceCount} instance{instanceCount !== 1 ? "s" : ""} detected
        </p>
        <pre className="text-xs overflow-auto max-h-96 whitespace-pre-wrap font-mono bg-muted p-3 rounded">
          {resultText}
        </pre>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// FilePreviewModal
// ---------------------------------------------------------------------------

interface FilePreviewModalProps {
  file: AnalysisFile;
  onClose: () => void;
}

function FilePreviewModal({ file, onClose }: FilePreviewModalProps) {
  const [pages, setPages] = useState<HTMLCanvasElement[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!file.storage_path) { setError("No file available."); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPages([]);
    setZoom(1);

    (async () => {
      try {
        const { data: blob, error: dlErr } = await supabase.storage
          .from("drive-analysis-files")
          .download(file.storage_path!);
        if (dlErr || !blob) throw dlErr || new Error("Download failed");
        const ab = await blob.arrayBuffer();
        if (cancelled) return;
        const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
        if (cancelled) return;
        const maxPages = Math.min(pdf.numPages, 20);
        const canvases: HTMLCanvasElement[] = [];
        for (let i = 1; i <= maxPages; i++) {
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 2 });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext("2d")!;
          await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;
          if (cancelled) return;
          canvases.push(canvas);
        }
        setPages(canvases);
      } catch (e) {
        if (!cancelled) setError("Could not render file preview.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [file.storage_path]);

  useEffect(() => {
    if (!containerRef.current || pages.length === 0) return;
    const container = containerRef.current;
    container.innerHTML = "";
    for (const canvas of pages) {
      canvas.style.display = "block";
      canvas.style.maxWidth = "100%";
      canvas.style.height = "auto";
      canvas.style.marginBottom = "8px";
      container.appendChild(canvas);
    }
  }, [pages]);

  const handleZoomIn = () => {
    const scroll = scrollRef.current;
    if (!scroll) { setZoom(z => Math.min(4, z + 0.25)); return; }
    const cx = scroll.scrollWidth > 0 ? (scroll.scrollLeft + scroll.clientWidth / 2) / scroll.scrollWidth : 0.5;
    const cy = scroll.scrollHeight > 0 ? (scroll.scrollTop + scroll.clientHeight / 2) / scroll.scrollHeight : 0.5;
    setZoom(prev => {
      const next = Math.min(4, prev + 0.25);
      requestAnimationFrame(() => {
        scroll.scrollLeft = cx * scroll.scrollWidth - scroll.clientWidth / 2;
        scroll.scrollTop = cy * scroll.scrollHeight - scroll.clientHeight / 2;
      });
      return next;
    });
  };

  const handleZoomOut = () => {
    const scroll = scrollRef.current;
    if (!scroll) { setZoom(z => Math.max(0.25, z - 0.25)); return; }
    const cx = scroll.scrollWidth > 0 ? (scroll.scrollLeft + scroll.clientWidth / 2) / scroll.scrollWidth : 0.5;
    const cy = scroll.scrollHeight > 0 ? (scroll.scrollTop + scroll.clientHeight / 2) / scroll.scrollHeight : 0.5;
    setZoom(prev => {
      const next = Math.max(0.25, prev - 0.25);
      requestAnimationFrame(() => {
        scroll.scrollLeft = cx * scroll.scrollWidth - scroll.clientWidth / 2;
        scroll.scrollTop = cy * scroll.scrollHeight - scroll.clientHeight / 2;
      });
      return next;
    });
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-5xl h-[90vh] flex flex-col p-0">
        {/* Fixed header with zoom controls */}
        <DialogHeader className="px-6 pt-5 pb-3 border-b flex-shrink-0">
          <div className="flex items-center justify-between gap-4">
            <DialogTitle className="truncate text-sm font-mono flex-1 min-w-0">{file.name}</DialogTitle>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={handleZoomOut} disabled={zoom <= 0.25 || loading}>
                <ZoomOut className="w-4 h-4" />
              </Button>
              <span className="text-sm min-w-[3rem] text-center tabular-nums">{Math.round(zoom * 100)}%</span>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={handleZoomIn} disabled={zoom >= 4 || loading}>
                <ZoomIn className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </DialogHeader>

        {/* Scrollable body */}
        <div ref={scrollRef} className="flex-1 overflow-auto bg-muted/20">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin mr-2" />
              <span className="text-sm text-muted-foreground">Loading…</span>
            </div>
          )}
          {error && <p className="text-sm text-destructive text-center py-8">{error}</p>}
          {!loading && !error && pages.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">No preview available.</p>
          )}
          <div
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: "top center",
              width: "fit-content",
              minWidth: "100%",
              padding: "16px",
            }}
          >
            <div ref={containerRef} />
          </div>
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
// AnalysisSection
// ---------------------------------------------------------------------------

export function AnalysisSection({ requestId, files, projectId, sourceType }: AnalysisSectionProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ---- New state architecture ----
  const [analyzingClasses, setAnalyzingClasses] = useState<Set<string>>(new Set());
  const [classFileStatuses, setClassFileStatuses] = useState<Record<string, Record<string, string>>>({});
  const abortControllers = useRef<Record<string, AbortController>>({});
  const [rawResultModal, setRawResultModal] = useState<{
    fileName: string;
    awpClassName: string;
    resultText: string;
    instanceCount: number;
  } | null>(null);

  // ---- Unchanged state ----
  const [summarizedInstances, setSummarizedInstances] = useState<Record<string, SummarizedInstance[]>>({});
  const [summarizing, setSummarizing] = useState<Record<string, boolean>>({});
  const [addingToProject, setAddingToProject] = useState<Record<string, boolean>>({});
  const [addedToProject, setAddedToProject] = useState<Record<string, boolean>>({});
  const [selectedInstance, setSelectedInstance] = useState<{
    instance: SummarizedInstance;
    awpClassName: string;
  } | null>(null);
  const [previewFile, setPreviewFile] = useState<AnalysisFile | null>(null);

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

  const { data: results } = useQuery({
    queryKey: ["analysis-results", requestId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("analysis_results")
        .select("*")
        .eq("analysis_request_id", requestId)
        .order("created_at");
      if (error) throw error;
      return data as AnalysisResult[];
    },
  });

  const { data: savedSummaryData, refetch: refetchSummary } = useQuery({
    queryKey: ["analysis-request-summary", requestId],
    queryFn: async () => {
      const { data } = await supabase
        .from("analysis_requests")
        .select("summary_data")
        .eq("id", requestId)
        .single();
      return (data?.summary_data as unknown as Record<string, SummarizedInstance[]>) || {};
    },
  });

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

  // Sorted prompts to match Configuration page order
  const sortedPrompts = useMemo(() => {
    if (!prompts) return [];
    return [...prompts].sort((a, b) => {
      const oa = globalOrderMap[a.awp_class_name] ?? 9999;
      const ob = globalOrderMap[b.awp_class_name] ?? 9999;
      return oa - ob;
    });
  }, [prompts, globalOrderMap]);

  // Helper to get the best prefix for a class name
  const getPrefix = (className: string) =>
    sourcePrefixMap[className] || idPrefixMap[className] || className.slice(0, 3).toUpperCase();

  // File Name header metadata
  const totalSizeBytes = copiedFiles.reduce((sum, f) => sum + ((f as any).size_bytes || 0), 0);
  const sourceLabel = (sourceType || "google_drive").replace(/_/g, " ");

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
        await refetchSummary();
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
  }, [requestId, toast, refetchSummary]);

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
    if (!prompt.drive_file_id || copiedFiles.length === 0) return;
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

    let aborted = false;

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

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
      const promptContent = resolveResult.content;

      if (!promptContent) {
        throw new Error("Could not retrieve prompt content from the linked document");
      }

      for (const file of copiedFiles) {
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
        toast({ title: "Analysis Complete", description: `Finished analyzing ${copiedFiles.length} files.` });
      }

      await queryClient.invalidateQueries({ queryKey: ["analysis-results", requestId] });

      if (!aborted) {
        handleSummarize(className);
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
        return next;
      });
      delete abortControllers.current[className];
    }
  };

  const handleAnalyzeAll = () => {
    sortedPrompts.forEach((p) => handleAnalyze(p));
  };

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

  const handleAddToProject = async (awpClassName: string) => {
    const instances = summarizedInstances[awpClassName];
    if (!instances || instances.length === 0 || !projectId) return;

    setAddingToProject((prev) => ({ ...prev, [awpClassName]: true }));
    try {
      const awpClass = awpClasses?.find(
        (c) =>
          c.name.toLowerCase() === awpClassName.toLowerCase() ||
          c.name.toLowerCase().startsWith(awpClassName.toLowerCase()) ||
          awpClassName.toLowerCase().startsWith(c.name.toLowerCase())
      );

      const idPrefix = awpClass?.id_prefix || "AWP";
      const awpClassId = awpClass?.id || null;
      const category = awpClass?.category || "Asset";

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

      const rows = instances.map((inst, idx) => {
        const seqNum = existingCount + idx + 1;
        const itemId = `${idPrefix}${String(seqNum).padStart(3, "0")}`;
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
        };
      });

      const { error } = await supabase.from("project_analysis_items").insert(rows);
      if (error) throw error;

      setAddedToProject((prev) => ({ ...prev, [awpClassName]: true }));
      toast({
        title: "Added to Project",
        description: `${rows.length} ${awpClassName} instances added to the project.`,
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

  const countForCell = (fileId: string, className: string): CellValue => {
    const liveStatus = classFileStatuses[className]?.[fileId];
    if (liveStatus === "processing") return "loading";
    if (liveStatus === "failed") return "failed";

    // Fall back to DB results
    const result = results?.find((r) => r.file_id === fileId && r.awp_class_name === className);
    if (!result) return null;
    if (result.status === "failed") return "failed";
    if (result.status === "complete" && result.result_text) {
      const parsed = parseResultText(result.result_text);
      return parsed.length;
    }
    return null;
  };

  const getResultsForClass = (className: string) =>
    results?.filter((r) => r.awp_class_name === className) || [];

  // ---- Early returns ----

  if (promptsLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (!prompts?.length) return null;

  const anyAnalyzing = analyzingClasses.size > 0;

  return (
    <TooltipProvider delayDuration={0}>
      <div className="space-y-6">

        {/* ================================================================
            Drawing Analysis Grid
        ================================================================ */}
        <div className="bg-card border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <h2 className="text-base font-semibold">Drawing Analysis</h2>
            <Button
              size="sm"
              onClick={handleAnalyzeAll}
              disabled={anyAnalyzing || copiedFiles.length === 0}
            >
              {anyAnalyzing ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Play className="w-4 h-4 mr-2" />
              )}
              Analyze All
            </Button>
          </div>

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
                    <th className="sticky left-0 z-10 bg-card px-4 py-2 text-left font-medium text-muted-foreground min-w-[320px] border-r">
                      <span className="block text-sm">File Name</span>
                      <span className="block text-xs font-normal text-muted-foreground/70">
                        {copiedFiles.length} files · {formatBytes(totalSizeBytes)} · {sourceLabel}
                      </span>
                    </th>
                     {sortedPrompts.map((prompt) => (
                      <th key={prompt.id} className="w-14 px-2 py-2 text-center font-medium text-muted-foreground">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-default font-mono text-xs">
                              {getPrefix(prompt.awp_class_name)}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>{prompt.awp_class_name}</TooltipContent>
                        </Tooltip>
                      </th>
                    ))}
                  </tr>

                  {/* Button sub-row: per-column analyze/stop controls */}
                  <tr className="border-b bg-muted/20">
                     <td className="sticky left-0 z-10 bg-muted/20 px-4 py-1.5 border-r min-w-[320px]">
                       <Button size="sm" variant="outline" className="h-6 text-xs gap-1" onClick={handleDownloadZip}>
                         <Download className="w-3 h-3" />
                         Download ZIP
                       </Button>
                     </td>
                    
                     {sortedPrompts.map((prompt) => {
                       const className = prompt.awp_class_name;
                       const isAnalyzing = analyzingClasses.has(className);
                       const hasResults = (results?.some((r) => r.awp_class_name === className)) || false;

                       return (
                         <td key={prompt.id} className="w-14 px-2 py-1.5 text-center">
                           {isAnalyzing ? (
                             <div className="flex items-center justify-center gap-1">
                               <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                               <Button
                                 size="icon"
                                 variant="destructive"
                                 className="h-6 w-6"
                                 onClick={() => handleStop(className)}
                               >
                                 <Square className="w-3 h-3" />
                               </Button>
                             </div>
                           ) : (
                             <Tooltip>
                               <TooltipTrigger asChild>
                                 <Button
                                   size="icon"
                                   variant="ghost"
                                   className="h-6 w-6"
                                   disabled={copiedFiles.length === 0}
                                   onClick={() => handleAnalyze(prompt)}
                                 >
                                   {hasResults ? (
                                     <RotateCcw className="w-3 h-3" />
                                   ) : (
                                     <Play className="w-3 h-3" />
                                   )}
                                 </Button>
                               </TooltipTrigger>
                               <TooltipContent>
                                 {hasResults ? `Re-analyze ${className}` : `Analyze ${className}`}
                               </TooltipContent>
                             </Tooltip>
                           )}
                         </td>
                       );
                     })}
                  </tr>
                </thead>

                <tbody>
                  {copiedFiles.map((file) => (
                    <tr key={file.id} className="border-b hover:bg-muted/30 transition-colors">
                      {/* File name (sticky) */}
                      <td className="sticky left-0 z-10 bg-card hover:bg-muted/30 px-4 py-2 border-r min-w-[320px]">
                        <button
                          className="text-sm font-medium truncate block max-w-[300px] text-primary hover:underline text-left"
                          onClick={() => setPreviewFile(file)}
                        >
                          {file.name}
                        </button>
                      </td>


                       {/* Per-class cells */}
                       {sortedPrompts.map((prompt) => {
                        const val = countForCell(file.id, prompt.awp_class_name);
                        const className = prompt.awp_class_name;

                        if (val === "loading") {
                          return (
                            <td key={prompt.id} className="w-14 px-2 py-2 text-center">
                              <Loader2 className="w-3 h-3 animate-spin text-muted-foreground mx-auto" />
                            </td>
                          );
                        }

                        if (val === "failed") {
                          return (
                            <td key={prompt.id} className="w-14 px-2 py-2 text-center">
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
                            (r) => r.file_id === file.id && r.awp_class_name === className
                          );
                          return (
                            <td key={prompt.id} className="w-14 px-2 py-2 text-center">
                              <button
                                className="text-xs font-semibold text-primary hover:underline"
                                onClick={() => {
                                  if (result?.result_text) {
                                    setRawResultModal({
                                      fileName: file.name,
                                      awpClassName: className,
                                      resultText: result.result_text,
                                      instanceCount: val,
                                    });
                                  }
                                }}
                              >
                                {val}
                              </button>
                            </td>
                          );
                        }

                        if (typeof val === "number" && val === 0) {
                          return (
                            <td key={prompt.id} className="w-14 px-2 py-2 text-center text-xs text-muted-foreground">
                              0
                            </td>
                          );
                        }

                        // null — not yet analyzed
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
          <div className="px-4 py-3 border-b flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <h2 className="text-base font-semibold">Analysis Summary</h2>
          </div>

          <div className="divide-y">
            {sortedPrompts.map((prompt) => {
              const className = prompt.awp_class_name;
              const prefix = getPrefix(className);
              const isSummarizing = summarizing[className];
              const summary = summarizedInstances[className];
              const isAdding = addingToProject[className];
              const isAdded = addedToProject[className];

              return (
                <div key={prompt.id}>
                  {/* Sub-header */}
                  <div className="px-4 py-2.5 flex items-center justify-between bg-muted/20">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{className}</span>
                      <span className="text-xs text-muted-foreground font-mono">({prefix})</span>
                      {isSummarizing && (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                      )}
                    </div>

                    {summary && summary.length > 0 && (
                      <Button
                        size="sm"
                        variant={isAdded ? "outline" : "default"}
                        onClick={() => handleAddToProject(className)}
                        disabled={isAdding || isAdded}
                      >
                        {isAdding ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <PlusCircle className="w-4 h-4 mr-2" />
                        )}
                        {isAdded ? "Added" : "Add to Project"}
                      </Button>
                    )}
                  </div>

                  {/* Content */}
                  {!summary && !isSummarizing && (
                    <div className="px-4 py-3 text-sm text-muted-foreground">
                      — Not yet analyzed
                    </div>
                  )}

                  {isSummarizing && !summary && (
                    <div className="px-4 py-3 flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Summarizing…
                    </div>
                  )}

                  {summary && summary.length === 0 && (
                    <div className="px-4 py-3 text-sm text-muted-foreground">
                      None identified
                    </div>
                  )}

                  {summary && summary.length > 0 && (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Display ID</TableHead>
                          <TableHead>Name</TableHead>
                          <TableHead>Floor</TableHead>
                          <TableHead className="text-right">Area (sqft)</TableHead>
                          <TableHead className="w-10" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {summary.map((inst, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="font-mono text-sm">{inst.id}</TableCell>
                            <TableCell className="text-sm">{inst.name}</TableCell>
                            <TableCell className="text-sm">{inst.floor}</TableCell>
                            <TableCell className="text-sm text-right text-muted-foreground">
                              {inst.area_sqft > 0 ? inst.area_sqft : "—"}
                            </TableCell>
                            <TableCell className="text-right py-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0"
                                onClick={() => setSelectedInstance({ instance: inst, awpClassName: className })}
                              >
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
            })}
          </div>
        </div>
      </div>

      {/* FilePreviewModal */}
      {previewFile && (
        <FilePreviewModal
          file={previewFile}
          onClose={() => setPreviewFile(null)}
        />
      )}

      {/* RawResultModal */}
      {rawResultModal && (
        <RawResultModal
          fileName={rawResultModal.fileName}
          awpClassName={rawResultModal.awpClassName}
          resultText={rawResultModal.resultText}
          instanceCount={rawResultModal.instanceCount}
          onClose={() => setRawResultModal(null)}
        />
      )}

      {/* Instance Detail Modal */}
      {selectedInstance && (() => {
        const { instance, awpClassName } = selectedInstance;
        const classResults = getResultsForClass(awpClassName);
        // Combine all complete result_texts so bounding box parser can search across all files
        const combinedResultText = classResults
          .filter((r) => r.status === "complete" && r.result_text)
          .map((r) => r.result_text!)
          .join("\n");
        // Pick the file whose result_text contains the instance name or any identifier fragment
        const sourceResult =
          classResults.find((r) => r.result_text && r.status === "complete" && r.result_text.includes(instance.name)) ||
          classResults.find((r) => r.status === "complete" && r.result_text);
        const sourceFile = files.find((f) => f.id === sourceResult?.file_id);
        return (
          <InstanceDetailModal
            instance={instance}
            awpClassName={awpClassName}
            sourceFile={sourceFile}
            resultText={combinedResultText || undefined}
            onClose={() => setSelectedInstance(null)}
          />
        );
      })()}
    </TooltipProvider>
  );
}
