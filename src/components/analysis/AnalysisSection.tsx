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
  Filter,
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
  try {
    const lines = resultText.split("\n").filter((l) => l.includes("|"));
    if (lines.length < 2) return [];

    // Find header row
    let headerIdx = -1;
    const HEADER_KW = ["room code", "generated room", "code", "id", "label", "name"];
    for (let i = 0; i < lines.length; i++) {
      const low = lines[i].toLowerCase();
      if (HEADER_KW.some((k) => low.includes(k)) && (lines[i].match(/\|/g) || []).length >= 2) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx === -1) return [];

    const headers = lines[headerIdx].split("|").map((c) => c.trim().toLowerCase());
    const idCol = headers.findIndex((h) =>
      h.includes("generated room") || h.includes("room code") || h.includes("code") || h === "id"
    );
    const pageCol = headers.findIndex((h) => h.includes("page") || h.includes("sheet"));
    if (idCol === -1) return [];

    const dataLines = lines.slice(headerIdx + 1).filter((l) => !l.match(/^[\s|:-]+$/));
    const tags: Array<{ tag: string; pageNum: number }> = [];

    for (const line of dataLines) {
      const cells = line.split("|").map((c) => c.trim());
      const tag = cells[idCol];
      if (!tag || tag === "-" || tag.toLowerCase().includes("none") || tag.toLowerCase().includes("no instance")) continue;
      let pageNum = 1;
      if (pageCol !== -1) {
        const pv = parseInt(cells[pageCol] || "1", 10);
        if (!isNaN(pv) && pv > 0) pageNum = pv;
      }
      tags.push({ tag, pageNum });
    }
    return tags;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Deterministic BBox from pdf.js text layer
// ---------------------------------------------------------------------------

interface PDFBBox {
  x1: number; // PDF user space (pts, bottom-left origin)
  y1: number;
  x2: number;
  y2: number;
  pageNum: number;
}

/** Normalize a PDF text item string for matching: case-fold, trim, collapse whitespace,
 *  and normalize all hyphen/dash variants to ASCII hyphen. */
function normalizeText(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\uFE58\uFE63\uFF0D]/g, "-") // normalize dashes
    .replace(/\s+/g, " ");
}

/**
 * Compute a bbox from a single text item's transform matrix.
 * Returns [x1, y1, x2, y2] in PDF user space (bottom-left origin).
 */
function itemBBox(item: { transform: number[]; width: number; height: number }): [number, number, number, number] {
  const [, , , , tx, ty] = item.transform;
  const iw = Math.abs(item.width);
  const ih = Math.abs(item.height) || 10;
  return [tx, ty, tx + iw, ty + ih];
}

/**
 * Search all pages of a loaded PDF document for the exact room tag string.
 *
 * Matching strategy:
 *  1. Exact full-string match (after normalisation) of item.str against the primary tag
 *     (e.g. item.str normalised === "swc-b04").
 *  2. If the tag is split across consecutive items on the same line (same Y ± 4 pts,
 *     adjacent X), concatenate them and check for a full match.
 *  3. Optionally union the nearest "room name" line (ELECTRICAL / IT ROOM / etc.)
 *     that is within ±60 pts vertically of the matched tag centre — but ONLY if
 *     it is a known room-name keyword and within ±80 pts horizontally.
 *  4. If no exact match is found → return null (never fall back to page bounds).
 *  5. Partial/substring matches (e.g. "includes('B05')") are NOT used.
 */
const ROOM_NAME_KEYWORDS = [
  "electrical", "substation", "it room", "telecom", "transformer",
  "generator", "switchgear", "mdf", "idf", "ups", "power",
];

async function findBBoxInTextLayer(
  pdf: pdfjsLib.PDFDocumentProxy,
  primaryTag: string,        // e.g. "SWC-B04" — the exact tag to locate
  hintPageNum?: number
): Promise<PDFBBox | null> {
  const normTag = normalizeText(primaryTag);
  if (!normTag || normTag.length < 2) return null;

  // Try hinted page first, then all pages
  const pageOrder: number[] = [];
  if (hintPageNum && hintPageNum >= 1 && hintPageNum <= pdf.numPages) {
    pageOrder.push(hintPageNum);
  }
  for (let i = 1; i <= pdf.numPages; i++) {
    if (!pageOrder.includes(i)) pageOrder.push(i);
  }

  for (const pageNum of pageOrder) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const items = textContent.items as Array<{
      str: string;
      transform: number[];
      width: number;
      height: number;
    }>;

    // --- Pass 1: exact single-item match ---
    let matchedItem: typeof items[0] | null = null;
    for (const item of items) {
      if (normalizeText(item.str) === normTag) {
        matchedItem = item;
        break;
      }
    }

    // --- Pass 2: tag split across consecutive items on the same line ---
    if (!matchedItem) {
      for (let i = 0; i < items.length - 1; i++) {
        // Try concatenating up to 4 adjacent items with close Y and X positions
        let concat = "";
        let spanItems: typeof items = [];
        for (let j = i; j < Math.min(i + 4, items.length); j++) {
          const baseY = items[i].transform[5];
          const curY = items[j].transform[5];
          if (Math.abs(curY - baseY) > 4) break; // different line
          concat += items[j].str;
          spanItems.push(items[j]);
          if (normalizeText(concat) === normTag) {
            // Use the first item in the span as the anchor; bbox will cover all
            matchedItem = items[i];
            // Override with a synthetic "wide" item covering the span
            const [sx1,, , , ,] = itemBBox(spanItems[0]);
            const [,, sx2, sy2,,] = itemBBox(spanItems[spanItems.length - 1]);
            matchedItem = {
              ...items[i],
              width: sx2 - sx1,
            };
            break;
          }
        }
        if (matchedItem) break;
      }
    }

    if (!matchedItem) continue; // try next page

    console.log(`[BBox] exact match "${primaryTag}" on page ${pageNum}:`, {
      str: matchedItem.str, x: matchedItem.transform[4], y: matchedItem.transform[5],
      w: matchedItem.width, h: matchedItem.height,
    });

    // Compute base bbox from the matched tag item
    const [mx1, my1, mx2, my2] = itemBBox(matchedItem);
    const tagCentreX = (mx1 + mx2) / 2;
    const tagCentreY = (my1 + my2) / 2;

    // --- Pass 3: find the nearest room-name line within ±60 pts vertically ---
    let rnx1 = mx1, rny1 = my1, rnx2 = mx2, rny2 = my2;
    let foundRoomName = false;
    let bestDist = Infinity;

    for (const item of items) {
      const norm = normalizeText(item.str);
      if (!ROOM_NAME_KEYWORDS.some((kw) => norm.includes(kw))) continue;
      const [ix1, iy1, ix2, iy2] = itemBBox(item);
      const iCentreX = (ix1 + ix2) / 2;
      const iCentreY = (iy1 + iy2) / 2;
      const dy = Math.abs(iCentreY - tagCentreY);
      const dx = Math.abs(iCentreX - tagCentreX);
      if (dy > 60 || dx > 80) continue; // outside proximity window
      if (dy < bestDist) {
        bestDist = dy;
        rnx1 = Math.min(mx1, ix1);
        rny1 = Math.min(my1, iy1);
        rnx2 = Math.max(mx2, ix2);
        rny2 = Math.max(my2, iy2);
        foundRoomName = true;
      }
    }

    if (foundRoomName) {
      console.log(`[BBox] unioned with nearby room-name line`);
    }

    const PAD = 4;
    return {
      x1: (foundRoomName ? rnx1 : mx1) - PAD,
      y1: (foundRoomName ? rny1 : my1) - PAD,
      x2: (foundRoomName ? rnx2 : mx2) + PAD,
      y2: (foundRoomName ? rny2 : my2) + PAD,
      pageNum,
    };
  }

  console.log(`[BBox] no exact match found for "${primaryTag}" — not drawing bbox`);
  return null; // no fallback to page bounds
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
  const didAutoFitRef = useRef(false);

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

        // Determine the primary tag to search for — exact room code takes priority.
        // We parse the AI result for any tag that exactly matches instance.id,
        // then fall back to instance.id itself (which is the room code e.g. "SWC-B04").
        const aiTags = resultText ? parseRoomTagsFromResult(resultText) : [];
        const instanceTag = aiTags.find(
          (t) => t.tag === instance.id
        ) ?? aiTags.find(
          (t) => t.tag.toUpperCase() === instance.id.toUpperCase()
        ) ?? aiTags[0];

        // Primary tag: use the exact tag string from AI result if available,
        // otherwise fall back to instance.id (e.g. "SWC-B04").
        const primaryTag = instanceTag?.tag ?? instance.id;
        const hintPage = instanceTag?.pageNum;

        console.log(`[BBox] opening: instance.id=${instance.id} instance.name=${instance.name}`);
        console.log(`[BBox] primaryTag="${primaryTag}" hintPage=${hintPage}`);
        console.log(`[BBox] aiTags from result=`, aiTags);

        const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
        if (cancelled) return;

        // Deterministic bbox: exact match in PDF text layer — no substring/partial fallback
        const textBBox = await findBBoxInTextLayer(pdf, primaryTag, hintPage);
        if (cancelled) return;

        console.log(`[BBox] text layer result=`, textBBox);
        if (textBBox) {
          setRawCoords({ x1: textBBox.x1, y1: textBBox.y1, x2: textBBox.x2, y2: textBBox.y2 });
        }

        const targetPage = textBBox?.pageNum ?? hintPage ?? 1;
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
    // Safeguard 3: reset scroll position on new image load
    containerRef.current?.scrollTo({ left: 0, top: 0 });
    // Safeguard 4: allow auto-fit to fire again for the new image
    didAutoFitRef.current = false;
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
      console.log(`[BBox] drawing: rawCoords=`, rawCoords);
      console.log(`[BBox] pdfViewport scale=${pdfViewport.scale}, width=${pdfViewport.width}, height=${pdfViewport.height}`);
      const viewportRect = pdfViewport.convertToViewportRectangle([
        rawCoords.x1, rawCoords.y1, rawCoords.x2, rawCoords.y2,
      ]);
      console.log(`[BBox] convertToViewportRectangle output=`, viewportRect);
      const [vx1, vy1, vx2, vy2] = viewportRect;
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

  // Step 4: Auto fit-selection — fires once per modal open when all data is ready
  useEffect(() => {
    // Guard: only run once per load
    if (didAutoFitRef.current) return;
    if (!rawCoords || !pdfViewport || !offscreenSize || !baseDimensions) return;
    const container = containerRef.current;
    if (!container) return;

    // Convert PDF user-space → offscreen canvas pixels
    const [vx1, vy1, vx2, vy2] = pdfViewport.convertToViewportRectangle([
      rawCoords.x1, rawCoords.y1, rawCoords.x2, rawCoords.y2,
    ]);

    // Normalise to [0..1] and map to base canvas pixels (zoom = 1)
    const nx1 = Math.min(vx1, vx2) / offscreenSize.w;
    const ny1 = Math.min(vy1, vy2) / offscreenSize.h;
    const nx2 = Math.max(vx1, vx2) / offscreenSize.w;
    const ny2 = Math.max(vy1, vy2) / offscreenSize.h;

    const bx = nx1 * baseDimensions.width;
    const by = ny1 * baseDimensions.height;
    const bw = (nx2 - nx1) * baseDimensions.width;
    const bh = (ny2 - ny1) * baseDimensions.height;

    // Safeguard 1: skip zero-size bbox
    if (bw <= 1 || bh <= 1) return;

    // Compute fit zoom (20% padding, clamped 1.0–4.0)
    const PADDING = 0.20;
    const fitScale = Math.min(
      container.clientWidth  / (bw * (1 + PADDING)),
      container.clientHeight / (bh * (1 + PADDING)),
    );
    const targetZoom = Math.min(4.0, Math.max(1.0, fitScale));

    // bbox center in zoomed-canvas pixels (captured in closure for double-RAF)
    const cx = (bx + bw / 2) * targetZoom;
    const cy = (by + bh / 2) * targetZoom;

    // Mark as done before applying (prevents any re-entry)
    didAutoFitRef.current = true;

    setZoom(targetZoom);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const c = containerRef.current;
        if (!c) return;
        // Safeguard 2: non-negative clamp for maxLeft/maxTop
        const maxLeft = Math.max(0, c.scrollWidth  - c.clientWidth);
        const maxTop  = Math.max(0, c.scrollHeight - c.clientHeight);
        const left = Math.min(maxLeft, Math.max(0, cx - c.clientWidth  / 2));
        const top  = Math.min(maxTop,  Math.max(0, cy - c.clientHeight / 2));
        c.scrollTo({ left, top }); // instant, no animation
      });
    });
  }, [rawCoords, pdfViewport, offscreenSize, baseDimensions]);

  // Center-preserving zoom handlers — exact copy from LocationDetailsModal
  const handleZoomIn = () => {
    const container = containerRef.current;
    if (!container) { setZoom(z => Math.min(8, z + 0.25)); return; }
    const scrollCenterX = container.scrollWidth > 0
      ? (container.scrollLeft + container.clientWidth / 2) / container.scrollWidth : 0.5;
    const scrollCenterY = container.scrollHeight > 0
      ? (container.scrollTop + container.clientHeight / 2) / container.scrollHeight : 0.5;
    setZoom(prevZoom => {
      const newZoom = Math.min(8, prevZoom + 0.25);
      requestAnimationFrame(() => {
        container.scrollLeft = scrollCenterX * container.scrollWidth - container.clientWidth / 2;
        container.scrollTop = scrollCenterY * container.scrollHeight - container.clientHeight / 2;
      });
      return newZoom;
    });
  };

  const handleZoomOut = () => {
    const container = containerRef.current;
    if (!container) { setZoom(z => Math.max(0.25, z - 0.25)); return; }
    const scrollCenterX = container.scrollWidth > 0
      ? (container.scrollLeft + container.clientWidth / 2) / container.scrollWidth : 0.5;
    const scrollCenterY = container.scrollHeight > 0
      ? (container.scrollTop + container.clientHeight / 2) / container.scrollHeight : 0.5;
    setZoom(prevZoom => {
      const newZoom = Math.max(0.25, prevZoom - 0.25);
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
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={handleZoomOut} disabled={zoom <= 0.25}>
                  <ZoomOut className="w-4 h-4" />
                </Button>
                <span className="text-sm min-w-[3rem] text-center tabular-nums">{Math.round(zoom * 100)}%</span>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={handleZoomIn} disabled={zoom >= 8}>
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
  sourceFile?: AnalysisFile;
  onClose: () => void;
}

function RawResultModal({ fileName, awpClassName, resultText, instanceCount, sourceFile, onClose }: RawResultModalProps) {
  const [pages, setPages] = useState<HTMLCanvasElement[]>([]);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [bboxCount, setBboxCount] = useState(0);
  const pdfContainerRef = useRef<HTMLDivElement>(null);
  const pdfScrollRef = useRef<HTMLDivElement>(null);

  // Load PDF from storage and draw bounding boxes
  useEffect(() => {
    const storagePath = sourceFile?.storage_path;
    if (!storagePath) { setPdfError("Drawing not available"); return; }
    let cancelled = false;
    setPdfLoading(true);
    setPdfError(null);
    setPages([]);
    setZoom(1);
    setBboxCount(0);

    (async () => {
      try {
        const { data: blob, error: dlErr } = await supabase.storage
          .from("drive-analysis-files")
          .download(storagePath);
        if (dlErr || !blob) throw dlErr || new Error("Download failed");
        const ab = await blob.arrayBuffer();
        if (cancelled) return;
        const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
        if (cancelled) return;

        // Parse room tags from AI result text
        const roomTags = resultText ? parseRoomTagsFromResult(resultText) : [];
        console.log(`[RawResultModal] Found ${roomTags.length} room tags to locate:`, roomTags.map(t => t.tag));

        // Find all bboxes
        const bboxes: PDFBBox[] = [];
        for (const { tag, pageNum } of roomTags) {
          const bbox = await findBBoxInTextLayer(pdf, tag, pageNum);
          if (bbox) bboxes.push(bbox);
          if (cancelled) return;
        }
        console.log(`[RawResultModal] Found ${bboxes.length} bounding boxes`);
        setBboxCount(bboxes.length);

        // Render pages with bbox overlays
        const maxPages = Math.min(pdf.numPages, 20);
        const canvases: HTMLCanvasElement[] = [];
        for (let i = 1; i <= maxPages; i++) {
          const page = await pdf.getPage(i);
          const scale = 4; // high-res for bbox precision
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext("2d")!;
          await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;
          if (cancelled) return;

          // Draw bounding boxes for this page
          const pageBboxes = bboxes.filter(b => b.pageNum === i);
          for (const bbox of pageBboxes) {
            // Convert PDF user-space coords to canvas pixels
            const rect = viewport.convertToViewportRectangle([bbox.x1, bbox.y1, bbox.x2, bbox.y2]);
            const [vx1, vy1, vx2, vy2] = rect;
            const x = Math.min(vx1, vx2);
            const y = Math.min(vy1, vy2);
            const w = Math.abs(vx2 - vx1);
            const h = Math.abs(vy2 - vy1);

            // Fill
            ctx.fillStyle = "rgba(239, 68, 68, 0.15)";
            ctx.fillRect(x, y, w, h);
            // Stroke
            ctx.strokeStyle = "rgba(239, 68, 68, 0.9)";
            ctx.lineWidth = 3;
            ctx.strokeRect(x, y, w, h);
          }

          canvases.push(canvas);
        }
        setPages(canvases);
      } catch (e) {
        if (!cancelled) setPdfError("Could not render drawing.");
      } finally {
        if (!cancelled) setPdfLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [sourceFile?.storage_path, resultText]);

  // Mount canvases into container
  useEffect(() => {
    if (!pdfContainerRef.current || pages.length === 0) return;
    const container = pdfContainerRef.current;
    container.innerHTML = "";
    for (const canvas of pages) {
      canvas.style.display = "block";
      canvas.style.maxWidth = "100%";
      canvas.style.height = "auto";
      canvas.style.marginBottom = "8px";
      container.appendChild(canvas);
    }
  }, [pages]);

  const handleZoom = (delta: number) => {
    const scroll = pdfScrollRef.current;
    if (!scroll) { setZoom(z => Math.min(8, Math.max(0.25, z + delta))); return; }
    const cx = scroll.scrollWidth > 0 ? (scroll.scrollLeft + scroll.clientWidth / 2) / scroll.scrollWidth : 0.5;
    const cy = scroll.scrollHeight > 0 ? (scroll.scrollTop + scroll.clientHeight / 2) / scroll.scrollHeight : 0.5;
    setZoom(prev => {
      const next = Math.min(8, Math.max(0.25, prev + delta));
      requestAnimationFrame(() => {
        scroll.scrollLeft = cx * scroll.scrollWidth - scroll.clientWidth / 2;
        scroll.scrollTop = cy * scroll.scrollHeight - scroll.clientHeight / 2;
      });
      return next;
    });
  };

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
          {/* Left: Drawing viewer */}
          <div className="flex-[6] flex flex-col min-w-0 border rounded-lg overflow-hidden bg-muted/30">
            <div className="h-10 flex-shrink-0 flex items-center justify-between px-3 border-b bg-background">
              <span className="text-xs text-muted-foreground truncate">Drawing Preview</span>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleZoom(-0.25)} disabled={zoom <= 0.25}>
                  <ZoomOut className="w-3.5 h-3.5" />
                </Button>
                <span className="text-xs w-10 text-center">{Math.round(zoom * 100)}%</span>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleZoom(0.25)} disabled={zoom >= 8}>
                  <ZoomIn className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
            <div ref={pdfScrollRef} className="flex-1 overflow-auto p-2">
              {pdfLoading ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : pdfError ? (
                <div className="flex items-center justify-center h-full text-xs text-muted-foreground">{pdfError}</div>
              ) : (
                <div
                  ref={pdfContainerRef}
                  style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}
                />
              )}
            </div>
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
    if (!scroll) { setZoom(z => Math.min(8, z + 0.25)); return; }
    const cx = scroll.scrollWidth > 0 ? (scroll.scrollLeft + scroll.clientWidth / 2) / scroll.scrollWidth : 0.5;
    const cy = scroll.scrollHeight > 0 ? (scroll.scrollTop + scroll.clientHeight / 2) / scroll.scrollHeight : 0.5;
    setZoom(prev => {
      const next = Math.min(8, prev + 0.25);
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
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={handleZoomIn} disabled={zoom >= 8 || loading}>
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
  const [triageModel, setTriageModel] = useState<string>("gpt-5-nano");
  const [analyzeModel, setAnalyzeModel] = useState<string>("gpt-5-mini");
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
  const [triageTokens, setTriageTokens] = useState(0);
  const [triagePhase, setTriagePhase] = useState<"extract" | "score" | null>(null);
  const [summaryGroupBy, setSummaryGroupBy] = useState<"awp" | "floor">("awp");
  const [triageProgress, setTriageProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [extractingFileIds, setExtractingFileIds] = useState<Set<string>>(new Set());
  const [extractedFileIds, setExtractedFileIds] = useState<Set<string>>(new Set());
  const [extractedTexts, setExtractedTexts] = useState<Map<string, string>>(new Map());
  const triageQueueRef = useRef<Array<{ file: AnalysisFile; prompt?: AWPPrompt; action: "extract" | "triage" }>>([]);
  const triageTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inFlightCountRef = useRef(0);
  const MAX_CONCURRENT_TRIAGE = 5;

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

  // Fetch existing triage results
  const { data: triageData } = useQuery({
    queryKey: ["triage-results", requestId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("analysis_triage_results")
        .select("file_id, awp_class_name, status, score, reason, error_message")
        .eq("analysis_request_id", requestId);
      if (error) throw error;
      return data as TriageResult[];
    },
  });

  // Hydrate triage results into map
  useEffect(() => {
    if (!triageData) return;
    const map = new Map<string, TriageResult>();
    for (const r of triageData) {
      map.set(`${r.file_id}_${r.awp_class_name}`, r);
    }
    setTriageResults(map);
  }, [triageData]);

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

    // Mark analysis request as processing in DB
    await supabase.from("analysis_requests").update({ status: "processing" }).eq("id", requestId);

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
        // If no more classes are analyzing, mark request as complete
        if (next.size === 0) {
          supabase.from("analysis_requests").update({ status: "complete" }).eq("id", requestId);
        }
        return next;
      });
      delete abortControllers.current[className];
    }
  };

  const handleAnalyzeAll = () => {
    sortedPrompts.forEach((p) => handleAnalyze(p));
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
        const response = await fetch(
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
          next.set(key, { file_id: item.file.id, awp_class_name: prompt.awp_class_name, status: "processing", score: null, reason: null, error_message: null });
          return next;
        });

        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/triage-drawings`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              analysisRequestId: requestId,
              fileId: item.file.id,
              awpClassName: prompt.awp_class_name,
              assetType: prompt.category,
              drawingName: item.file.name,
              promptContent: prompt.prompt_content || null,
              action: "triage",
            }),
          }
        );

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
            });
            return next;
          });
          if (data.usage?.total_tokens) {
            setTriageTokens((prev) => prev + data.usage.total_tokens);
          }
        } else {
          setTriageResults((prev) => {
            const next = new Map(prev);
            next.set(key, { file_id: item.file.id, awp_class_name: prompt.awp_class_name, status: "failed", score: null, reason: null, error_message: "Triage failed" });
            return next;
          });
        }
      }
    } catch (e) {
      if (item.action === "triage" && item.prompt) {
        const key = `${item.file.id}_${item.prompt.awp_class_name}`;
        setTriageResults((prev) => {
          const next = new Map(prev);
          next.set(key, { file_id: item.file.id, awp_class_name: item.prompt!.awp_class_name, status: "failed", score: null, reason: null, error_message: String(e) });
          return next;
        });
      }
    } finally {
      inFlightCountRef.current--;
      setTriageProgress((prev) => ({ ...prev, done: prev.done + 1 }));
    }
  };

  const startTriageScheduler = (onComplete: () => void) => {
    triageTimerRef.current = setInterval(() => {
      while (
        inFlightCountRef.current < MAX_CONCURRENT_TRIAGE &&
        triageQueueRef.current.length > 0
      ) {
        const item = triageQueueRef.current.shift()!;
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
      inFlightCountRef.current < MAX_CONCURRENT_TRIAGE &&
      triageQueueRef.current.length > 0
    ) {
      const item = triageQueueRef.current.shift()!;
      executeTriageItem(item);
    }
  };

  const handleTriageAll = async () => {
    // Clear previous triage results
    setTriageResults(new Map());
    setTriageTokens(0);
    setExtractingFileIds(new Set());
    setExtractedFileIds(new Set());
    setExtractedTexts(new Map());

    // Delete existing DB triage results and clear cached extracted_text
    await Promise.all([
      supabase.from("analysis_triage_results").delete().eq("analysis_request_id", requestId),
      supabase.from("analysis_request_files").update({ extracted_text: null } as any).eq("analysis_request_id", requestId),
    ]);
    queryClient.invalidateQueries({ queryKey: ["triage-results", requestId] });

    // After clearing, all files need extraction
    const allFiles = copiedFiles;

    // Phase 2 queue: all file×class pairs without pass-2 results
    const scoreQueue: Array<{ file: AnalysisFile; prompt: AWPPrompt; action: "extract" | "triage" }> = [];
    for (const prompt of sortedPrompts) {
      for (const file of copiedFiles) {
        const hasPass2 = results?.some(
          (r) => r.file_id === file.id && r.awp_class_name === prompt.awp_class_name && r.status === "complete"
        );
        if (hasPass2) continue;
        scoreQueue.push({ file, prompt, action: "triage" });
      }
    }

    if (allFiles.length === 0 && scoreQueue.length === 0) {
      toast({ title: "Nothing to triage", description: "No files available." });
      return;
    }

    setTriageRunning(true);
    inFlightCountRef.current = 0;

    if (allFiles.length > 0) {
      // Phase 1: Extract text for all files (we cleared cached text above)
      setTriagePhase("extract");
      setTriageProgress({ done: 0, total: allFiles.length });
      triageQueueRef.current = allFiles.map((f) => ({ file: f, action: "extract" as const }));

      startTriageScheduler(() => {
        // Phase 1 done → start Phase 2
        if (scoreQueue.length > 0) {
          setTriagePhase("score");
          setTriageProgress({ done: 0, total: scoreQueue.length });
          triageQueueRef.current = scoreQueue;
          inFlightCountRef.current = 0;
          startTriageScheduler(() => {
            setTriageRunning(false);
            setTriagePhase(null);
            queryClient.invalidateQueries({ queryKey: ["triage-results", requestId] });
          });
        } else {
          setTriageRunning(false);
          setTriagePhase(null);
        }
      });
    } else if (scoreQueue.length > 0) {
      // No files but have score queue (shouldn't happen normally)
      setTriagePhase("score");
      setTriageProgress({ done: 0, total: scoreQueue.length });
      triageQueueRef.current = scoreQueue;

      startTriageScheduler(() => {
        setTriageRunning(false);
        setTriagePhase(null);
        queryClient.invalidateQueries({ queryKey: ["triage-results", requestId] });
      });
    }
  };

  const [triageStopping, setTriageStopping] = useState(false);

  const handleStopTriage = () => {
    triageQueueRef.current = [];
    if (triageTimerRef.current) {
      clearInterval(triageTimerRef.current);
      triageTimerRef.current = null;
    }
    setTriageStopping(true);
    // Poll until in-flight requests finish
    const pollId = setInterval(() => {
      if (inFlightCountRef.current <= 0) {
        clearInterval(pollId);
        setTriageRunning(false);
        setTriagePhase(null);
        setTriageStopping(false);
      }
    }, 200);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (triageTimerRef.current) clearInterval(triageTimerRef.current);
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
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <label htmlFor="ai-model-select" className="text-xs text-muted-foreground whitespace-nowrap">AI model:</label>
                <select
                  id="ai-model-select"
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                  value={selectedModel}
                  onChange={(e) => {
                    setSelectedModel(e.target.value);
                    localStorage.setItem("analysis-ai-model", e.target.value);
                  }}
                  disabled={anyAnalyzing}
                >
                  <option value="gpt-5">OpenAI / gpt-5</option>
                  <option value="gpt-5-mini">OpenAI / gpt-5-mini</option>
                  <option value="gpt-5-nano">OpenAI / gpt-5-nano</option>
                  <option value="gemini-2.5-pro">Google / gemini-2.5-pro</option>
                  <option value="gemini-2.5-flash">Google / gemini-2.5-flash</option>
                  <option value="gemini-2.5-flash-lite">Google / gemini-2.5-flash-lite</option>
                </select>
              </div>
              {triageRunning && triagePhase && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {triagePhase === "extract"
                    ? `Extracting text: ${triageProgress.done}/${triageProgress.total} files`
                    : `Triaging: ${triageProgress.done}/${triageProgress.total} cells`}
                </span>
              )}
              {(triageRunning || triageTokens > 0) && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {triageTokens.toLocaleString()} tokens
                </span>
              )}
              {triageRunning ? (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleStopTriage}
                  disabled={triageStopping}
                >
                  {triageStopping ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Square className="w-4 h-4 mr-2" />
                  )}
                  {triageStopping ? "Stopping…" : "Stop Triage"}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleTriageAll}
                  disabled={anyAnalyzing || copiedFiles.length === 0}
                >
                  <Filter className="w-4 h-4 mr-2" />
                  Triage All
                </Button>
              )}
              <Button
                size="sm"
                onClick={handleAnalyzeAll}
                disabled={anyAnalyzing || triageRunning || copiedFiles.length === 0}
              >
                {anyAnalyzing ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Play className="w-4 h-4 mr-2" />
                )}
                Analyze All
              </Button>
            </div>
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
                    <th className="sticky left-0 z-10 bg-card px-4 py-2 text-left font-medium text-muted-foreground min-w-[180px] max-w-[320px] w-auto border-r">
                      <span className="block text-sm">File Name</span>
                      <span className="block text-xs font-normal text-muted-foreground/70">
                        {copiedFiles.length} files · {formatBytes(totalSizeBytes)} · {sourceLabel}
                      </span>
                    </th>
                     {sortedPrompts.map((prompt) => (
                      <th key={prompt.id} className="w-14 px-2 py-2 text-center font-medium text-muted-foreground">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            {prompt.drive_file_url ? (
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
                          <TooltipContent>{prompt.awp_class_name}</TooltipContent>
                        </Tooltip>
                      </th>
                    ))}
                  </tr>

                  {/* Button sub-row: per-column analyze/stop controls */}
                  <tr className="border-b bg-muted/20">
                     <td className="sticky left-0 z-10 bg-muted/20 px-4 py-1.5 border-r min-w-[180px] max-w-[320px] w-auto">
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
                      <td className="sticky left-0 z-10 bg-card hover:bg-muted/30 px-4 py-2 border-r min-w-[180px] max-w-[320px] w-auto">
                        <div className="flex items-center gap-2 min-w-0">
                          <button
                            className="text-sm font-medium truncate flex-1 min-w-0 text-primary hover:underline text-left"
                            onClick={() => setPreviewFile(file)}
                          >
                            {file.name}
                          </button>
                          {extractingFileIds.has(file.id) && (
                            <Loader2 className="w-3 h-3 animate-spin text-muted-foreground flex-shrink-0" />
                          )}
                          {extractedFileIds.has(file.id) && !extractingFileIds.has(file.id) && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex items-center rounded-full border border-emerald-300 bg-emerald-100 px-1.5 py-px text-[10px] font-medium text-emerald-800 leading-tight flex-shrink-0 cursor-default">
                                  Processed
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="right" className="max-w-[350px] max-h-[200px] overflow-auto p-2">
                                <p className="text-xs whitespace-pre-wrap break-words">
                                  {extractedTexts.get(file.id)
                                    ? (extractedTexts.get(file.id)!.length > 500
                                        ? extractedTexts.get(file.id)!.slice(0, 500) + "…"
                                        : extractedTexts.get(file.id))
                                    : "(no text extracted)"}
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </div>
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
                            (r) => r.file_id === file.id && r.awp_class_name === className && r.status === "complete" && r.result_text
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
                                      sourceFile: file,
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
                          const result0 = results?.find(
                            (r) => r.file_id === file.id && r.awp_class_name === className && r.status === "complete" && r.result_text
                          );
                          return (
                            <td key={prompt.id} className="w-14 px-2 py-2 text-center">
                              {result0?.result_text ? (
                                <button
                                  className="text-xs text-muted-foreground hover:text-foreground hover:underline cursor-pointer"
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
                                <span className="text-xs text-muted-foreground">0</span>
                              )}
                            </td>
                          );
                        }

                        // null — not yet analyzed; check for triage result
                        const triageKey = `${file.id}_${prompt.awp_class_name}`;
                        const triage = triageResults.get(triageKey);

                        if (triage?.status === "processing") {
                          return (
                            <td key={prompt.id} className="w-14 px-2 py-2 text-center">
                              <Loader2 className="w-3 h-3 animate-spin text-muted-foreground mx-auto" />
                            </td>
                          );
                        }

                        if (triage?.status === "complete" && triage.score !== null) {
                          return (
                            <td
                              key={prompt.id}
                              className="w-14 px-2 py-2 text-center"
                              style={{ backgroundColor: `rgba(34, 197, 94, ${triage.score / 100})` }}
                            >
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="block w-full h-full cursor-default">&nbsp;</span>
                                </TooltipTrigger>
                                <TooltipContent>{triage.score}% — {triage.reason || "No reason"}</TooltipContent>
                              </Tooltip>
                            </td>
                          );
                        }

                        if (triage?.status === "failed") {
                          return (
                            <td key={prompt.id} className="w-14 px-2 py-2 text-center">
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
              <Filter className="w-4 h-4 text-primary" />
              <h2 className="text-base font-semibold">Analysis Summary</h2>
            </div>
            <div className="flex items-center gap-1">
              <Button size="sm" variant={summaryGroupBy === "awp" ? "default" : "outline"} onClick={() => setSummaryGroupBy("awp")} className="h-7 text-xs">By AWP</Button>
              <Button size="sm" variant={summaryGroupBy === "floor" ? "default" : "outline"} onClick={() => setSummaryGroupBy("floor")} className="h-7 text-xs">By Floor</Button>
            </div>
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
                      {summary && summary.length > 0 && (
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
                const floors = Array.from(floorMap.keys()).sort();
                if (floors.length === 0) {
                  return <div className="px-4 py-3 text-sm text-muted-foreground">No summarized data yet.</div>;
                }
                return floors.map((floor) => (
                  <div key={floor}>
                    <div className="px-4 py-2.5 bg-muted/20">
                      <span className="text-sm font-medium">{floor}</span>
                      <span className="text-xs text-muted-foreground ml-2">({floorMap.get(floor)!.length} items)</span>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Display ID</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Name</TableHead>
                          <TableHead className="text-right">Area (sqft)</TableHead>
                          <TableHead className="w-10" />
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
          sourceFile={rawResultModal.sourceFile}
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
            onClose={() => setSelectedInstance(null)}
          />
        );
      })()}
    </TooltipProvider>
  );
}
