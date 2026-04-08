import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useMapNavigation } from "@/hooks/useMapNavigation";
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
  ScanLine,
  PlusCircle,
  Eye,
  RotateCcw,
  AlertTriangle,
  Download,
  ZoomIn,
  ZoomOut,
  Copy,
  Check,
  Search,
  FileSearch,
  Info,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
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
 *   1. drawing label / label
 *   2. generated room code / room code
 *   3. code / identifier / tag
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
      (h) => h.includes("drawing label") || h.includes("drawing code"),
      (h) => (h.includes("label") && !h.includes("page")) || h.includes("room code") || h.includes("generated room") || h.includes("room identifier"),
      (h) => h.includes("code") || h.includes("identifier") || h.includes("tag"),
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
      for (const ci of candidateColIndices) {
        const val = cells[ci];
        if (val && val !== "-" && !val.toLowerCase().includes("none") && !val.toLowerCase().includes("no instance") && val.length > 1) {
          candidates.push(val);
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
    .replace(/[\u00D8\u00F8\u2205\u2300]/g, "o") // diameter symbols Ø ø ∅ ⌀ → o
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

    // --- Pass 2.5: substring matching for long labels ---
    if (!matchedItem && normTag.length > 15) {
      let bestLen = 0;
      for (const item of items) {
        const normItem = normalizeText(item.str);
        if (normItem.length < 4) continue;
        if (normTag.includes(normItem) && normItem.length > bestLen) {
          bestLen = normItem.length;
          matchedItem = item;
        }
      }
      if (matchedItem) {
        console.log(`[BBox] substring match for "${primaryTag}" using "${matchedItem.str}" on page ${pageNum}`);
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
  const [isAiBBoxMode, setIsAiBBoxMode] = useState(false);
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

        // Build search candidates: parse all overlay rows from the AI result,
        // find the row whose candidates include instance.id, then use all its
        // candidates.  Fall back to instance.id if nothing matches.
        const overlayRows = resultText ? parseOverlayCandidates(resultText) : [];
        const matchingRow = overlayRows.find((r) =>
          r.candidates.some((c) => c.toUpperCase() === instance.id.toUpperCase())
        ) ?? overlayRows.find((r) =>
          r.candidates.some((c) => c.toUpperCase().includes(instance.id.toUpperCase()))
        );
        const searchCandidates = matchingRow?.candidates ?? [instance.id];
        const hintPage = matchingRow?.pageNum;
        const matchedAiBBox = matchingRow?.aiBBox;

        console.log(`[BBox] opening: instance.id=${instance.id} instance.name=${instance.name}`);
        console.log(`[BBox] searchCandidates=`, searchCandidates, `hintPage=${hintPage}`, `aiBBox=`, matchedAiBBox);

        const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
        if (cancelled) return;

        // Prefer AI bounding box coordinates; fall back to text-layer search
        let textBBox: PDFBBox | null = null;
        let useAiBBox = false;
        if (matchedAiBBox) {
          useAiBBox = true;
          console.log(`[BBox] Using AI bounding box:`, matchedAiBBox);
        } else {
          // Try each candidate until one matches in the PDF text layer
          for (const candidate of searchCandidates) {
            textBBox = await findBBoxInTextLayer(pdf, candidate, hintPage);
            if (textBBox) break;
            if (cancelled) return;
          }
        }
        if (cancelled) return;

        console.log(`[BBox] text layer result=`, textBBox, `useAiBBox=`, useAiBBox);
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

        // If using AI bbox, store as rawCoords in a special way
        // We'll convert AI pixel coords to PDF viewport coords for consistent rendering
        if (useAiBBox && matchedAiBBox) {
          // AI coords are in the same pixel space as the rendered image (scale 4)
          // Store them directly as viewport pixel coords (not PDF user-space)
          // We set rawCoords to a sentinel and handle in the draw step
          setRawCoords({
            x1: matchedAiBBox.x1,
            y1: matchedAiBBox.y1,
            x2: matchedAiBBox.x2,
            y2: matchedAiBBox.y2,
          });
          setIsAiBBoxMode(true);
        } else {
          setIsAiBBoxMode(false);
        }

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
      console.log(`[BBox] drawing: rawCoords=`, rawCoords, `isAiBBoxMode=`, isAiBBoxMode);
      let cx: number, cy: number, radius: number;

      if (isAiBBoxMode) {
        // AI pixel coordinates — map directly to display canvas
        // AI coords are in the same pixel space as offscreenSize (scale 4)
        const ncx = ((rawCoords.x1 + rawCoords.x2) / 2) / offscreenSize.w;
        const ncy = ((rawCoords.y1 + rawCoords.y2) / 2) / offscreenSize.h;
        const nbw = Math.abs(rawCoords.x2 - rawCoords.x1) / offscreenSize.w;
        const nbh = Math.abs(rawCoords.y2 - rawCoords.y1) / offscreenSize.h;
        cx = ncx * w;
        cy = ncy * h;
        const bw = nbw * w;
        const bh = nbh * h;
        radius = Math.max(bw, bh) / 2 + 20;
        radius = Math.max(radius, 15);
      } else {
        // PDF user-space (pts, origin bottom-left) → offscreen canvas pixels
        const viewportRect = pdfViewport.convertToViewportRectangle([
          rawCoords.x1, rawCoords.y1, rawCoords.x2, rawCoords.y2,
        ]);
        const [vx1, vy1, vx2, vy2] = viewportRect;
        const nx1 = Math.min(vx1, vx2) / offscreenSize.w;
        const ny1 = Math.min(vy1, vy2) / offscreenSize.h;
        const nx2 = Math.max(vx1, vx2) / offscreenSize.w;
        const ny2 = Math.max(vy1, vy2) / offscreenSize.h;
        cx = ((nx1 + nx2) / 2) * w;
        cy = ((ny1 + ny2) / 2) * h;
        const bw = (nx2 - nx1) * w;
        const bh = (ny2 - ny1) * h;
        radius = Math.max(bw, bh) / 2 + 20;
      }

      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(239, 68, 68, 0.12)";
      ctx.fill();
      ctx.strokeStyle = "rgba(239, 68, 68, 0.9)";
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
  }, [pageImage, baseDimensions, zoom, rawCoords, pdfViewport, offscreenSize, isAiBBoxMode]);

  // Step 4: Auto fit-selection — fires once per modal open when all data is ready
  useEffect(() => {
    // Guard: only run once per load
    if (didAutoFitRef.current) return;
    if (!rawCoords || !pdfViewport || !offscreenSize || !baseDimensions) return;
    const container = containerRef.current;
    if (!container) return;

    let bx: number, by: number, radius: number;

    if (isAiBBoxMode) {
      // AI pixel coordinates — map directly
      const ncx = ((rawCoords.x1 + rawCoords.x2) / 2) / offscreenSize.w;
      const ncy = ((rawCoords.y1 + rawCoords.y2) / 2) / offscreenSize.h;
      const nbw = Math.abs(rawCoords.x2 - rawCoords.x1) / offscreenSize.w;
      const nbh = Math.abs(rawCoords.y2 - rawCoords.y1) / offscreenSize.h;
      const bw = nbw * baseDimensions.width;
      const bh = nbh * baseDimensions.height;
      radius = Math.max(bw, bh) / 2 + 20;
      radius = Math.max(radius, 15);
      bx = ncx * baseDimensions.width - radius;
      by = ncy * baseDimensions.height - radius;
    } else {
      // Convert PDF user-space → offscreen canvas pixels
      const [vx1, vy1, vx2, vy2] = pdfViewport.convertToViewportRectangle([
        rawCoords.x1, rawCoords.y1, rawCoords.x2, rawCoords.y2,
      ]);
      const nx1 = Math.min(vx1, vx2) / offscreenSize.w;
      const ny1 = Math.min(vy1, vy2) / offscreenSize.h;
      const nx2 = Math.max(vx1, vx2) / offscreenSize.w;
      const ny2 = Math.max(vy1, vy2) / offscreenSize.h;
      const bw = (nx2 - nx1) * baseDimensions.width;
      const bh = (ny2 - ny1) * baseDimensions.height;
      radius = Math.max(bw, bh) / 2 + 20;
      bx = ((nx1 + nx2) / 2) * baseDimensions.width - radius;
      by = ((ny1 + ny2) / 2) * baseDimensions.height - radius;
    }

    const diameter = radius * 2;
    // Safeguard: skip zero-size region
    if (diameter <= 2) return;

    // Compute fit zoom (20% padding, clamped 1.0–4.0)
    const PADDING = 0.20;
    const fitScale = Math.min(
      container.clientWidth  / (diameter * (1 + PADDING)),
      container.clientHeight / (diameter * (1 + PADDING)),
    );
    const targetZoom = Math.min(4.0, Math.max(1.0, fitScale));

    // circle center in zoomed-canvas pixels
    const cx = (bx + radius) * targetZoom;
    const cy = (by + radius) * targetZoom;

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
    if (!container) { setZoom(z => Math.max(1, z - 0.25)); return; }
    const scrollCenterX = container.scrollWidth > 0
      ? (container.scrollLeft + container.clientWidth / 2) / container.scrollWidth : 0.5;
    const scrollCenterY = container.scrollHeight > 0
      ? (container.scrollTop + container.clientHeight / 2) / container.scrollHeight : 0.5;
    setZoom(prevZoom => {
      const newZoom = Math.max(1, prevZoom - 0.25);
      requestAnimationFrame(() => {
        container.scrollLeft = scrollCenterX * container.scrollWidth - container.clientWidth / 2;
        container.scrollTop = scrollCenterY * container.scrollHeight - container.clientHeight / 2;
      });
      return newZoom;
    });
  };

  const instanceMapNav = useMapNavigation({ zoom, setZoom, minZoom: 1, maxZoom: 8, containerRef });

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
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={handleZoomOut} disabled={zoom <= 1}>
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
              style={instanceMapNav.containerStyle}
              {...instanceMapNav.handlers}
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

        // Parse overlay candidates from AI result text (multi-candidate per row)
        const overlayRows = resultText ? parseOverlayCandidates(resultText) : [];
        console.log(`[RawResultModal] Found ${overlayRows.length} overlay rows:`, overlayRows.map(r => ({ candidates: r.candidates, aiBBox: r.aiBBox })));

        // Build circle data: prefer AI bounding box, fall back to text-layer search
        interface CircleData { cx: number; cy: number; radius: number; pageNum: number; source: "ai" | "text" }
        const circles: CircleData[] = [];
        for (const row of overlayRows) {
          if (row.aiBBox) {
            // AI bbox is in pixel coordinates of the image sent to OpenAI
            const { x1, y1, x2, y2 } = row.aiBBox;
            circles.push({
              cx: (x1 + x2) / 2,
              cy: (y1 + y2) / 2,
              radius: Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) / 2 + 30,
              pageNum: row.pageNum,
              source: "ai",
            });
          } else {
            // Fall back to text-layer search
            let found = false;
            for (const candidate of row.candidates) {
              const bbox = await findBBoxInTextLayer(pdf, candidate, row.pageNum);
              if (bbox) {
                circles.push({ cx: 0, cy: 0, radius: 0, pageNum: bbox.pageNum ?? row.pageNum, source: "text", ...bbox } as any);
                // We'll convert text-layer bboxes during rendering
                found = true;
                break;
              }
              if (cancelled) return;
            }
            if (!found) console.log(`[RawResultModal] No match for candidates:`, row.candidates);
          }
        }
        console.log(`[RawResultModal] Found ${circles.length} circle locations`);
        setBboxCount(circles.length);

        // Render pages with circle overlays
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

          // AI image dimensions: the image sent to OpenAI is the PDF page rendered at scale 4
          const aiImageW = viewport.width;
          const aiImageH = viewport.height;

          // Draw circles for this page
          const pageCircles = circles.filter(c => c.pageNum === i);
          for (const circle of pageCircles) {
            let cx: number, cy: number, radius: number;
            if (circle.source === "ai") {
              // AI coordinates are in the original image pixel space
              // Scale from AI image to canvas (both are scale=4, so 1:1 mapping)
              cx = (circle.cx / aiImageW) * viewport.width;
              cy = (circle.cy / aiImageH) * viewport.height;
              radius = (circle.radius / Math.max(aiImageW, aiImageH)) * Math.max(viewport.width, viewport.height);
              // Ensure minimum radius
              radius = Math.max(radius, 40);
            } else {
              // Text-layer fallback: circle has bbox coords stored
              const bbox = circle as any;
              const rect = viewport.convertToViewportRectangle([bbox.x1, bbox.y1, bbox.x2, bbox.y2]);
              const [vx1, vy1, vx2, vy2] = rect;
              const x = Math.min(vx1, vx2);
              const y = Math.min(vy1, vy2);
              const w = Math.abs(vx2 - vx1);
              const h = Math.abs(vy2 - vy1);
              cx = x + w / 2;
              cy = y + h / 2;
              radius = Math.max(w, h) / 2 + 80;
            }

            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(239, 68, 68, 0.15)";
            ctx.fill();
            ctx.strokeStyle = "rgba(239, 68, 68, 0.9)";
            ctx.lineWidth = 3;
            ctx.stroke();
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
    if (!scroll) { setZoom(z => Math.min(8, Math.max(1, z + delta))); return; }
    const cx = scroll.scrollWidth > 0 ? (scroll.scrollLeft + scroll.clientWidth / 2) / scroll.scrollWidth : 0.5;
    const cy = scroll.scrollHeight > 0 ? (scroll.scrollTop + scroll.clientHeight / 2) / scroll.scrollHeight : 0.5;
    setZoom(prev => {
      const next = Math.min(8, Math.max(1, prev + delta));
      requestAnimationFrame(() => {
        scroll.scrollLeft = cx * scroll.scrollWidth - scroll.clientWidth / 2;
        scroll.scrollTop = cy * scroll.scrollHeight - scroll.clientHeight / 2;
      });
      return next;
    });
  };

  const rawMapNav = useMapNavigation({ zoom, setZoom, minZoom: 1, maxZoom: 8, containerRef: pdfScrollRef });

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
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleZoom(-0.25)} disabled={zoom <= 1}>
                  <ZoomOut className="w-3.5 h-3.5" />
                </Button>
                <span className="text-xs w-10 text-center">{Math.round(zoom * 100)}%</span>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleZoom(0.25)} disabled={zoom >= 8}>
                  <ZoomIn className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
            <div ref={pdfScrollRef} className="flex-1 overflow-auto p-2" style={rawMapNav.containerStyle} {...rawMapNav.handlers}>
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
    if (!scroll) { setZoom(z => Math.max(1, z - 0.25)); return; }
    const cx = scroll.scrollWidth > 0 ? (scroll.scrollLeft + scroll.clientWidth / 2) / scroll.scrollWidth : 0.5;
    const cy = scroll.scrollHeight > 0 ? (scroll.scrollTop + scroll.clientHeight / 2) / scroll.scrollHeight : 0.5;
    setZoom(prev => {
      const next = Math.max(1, prev - 0.25);
      requestAnimationFrame(() => {
        scroll.scrollLeft = cx * scroll.scrollWidth - scroll.clientWidth / 2;
        scroll.scrollTop = cy * scroll.scrollHeight - scroll.clientHeight / 2;
      });
      return next;
    });
  };

  const filePreviewMapNav = useMapNavigation({ zoom, setZoom, minZoom: 1, maxZoom: 8, containerRef: scrollRef });

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-5xl h-[90vh] flex flex-col p-0">
        {/* Fixed header with zoom controls */}
        <DialogHeader className="px-6 pt-5 pb-3 border-b flex-shrink-0">
          <div className="flex items-center justify-between gap-4">
            <DialogTitle className="truncate text-sm font-mono flex-1 min-w-0">{file.name}</DialogTitle>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={handleZoomOut} disabled={zoom <= 1 || loading}>
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
        <div ref={scrollRef} className="flex-1 overflow-auto bg-muted/20" style={filePreviewMapNav.containerStyle} {...filePreviewMapNav.handlers}>
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
      const { data } = await supabase
        .from("analysis_request_files")
        .select("extracted_text")
        .eq("id", fileId)
        .single();
      if (!cancelled) {
        setText((data?.extracted_text as string) || null);
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
  const [triagingClasses, setTriagingClasses] = useState<Set<string>>(new Set());
  const [triageTokens, setTriageTokens] = useState(0);
  const [analyzeTokens, setAnalyzeTokens] = useState(0);
  const analyzeTokensRef = useRef(0);
  const [uploadingFileIds, setUploadingFileIds] = useState<Set<string>>(new Set());
  const [analyzeV2Running, setAnalyzeV2Running] = useState(false);
  const analyzeRunSyncRef = useRef<"idle" | "starting" | "running" | "stopping">("idle");
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
  const inFlightCountRef = useRef(0);
  const MAX_CONCURRENT_TRIAGE = 10;

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
    refetchInterval: analyzeV2Running ? 5000 : false,
  });

  // Fetch existing triage results
  const { data: triageData } = useQuery({
    queryKey: ["triage-results", requestId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("analysis_triage_results")
        .select("file_id, awp_class_name, status, score, reason, error_message, instances")
        .eq("analysis_request_id", requestId);
      if (error) throw error;
      return data as TriageResult[];
    },
    refetchOnWindowFocus: false,
  });

  // Hydrate triage results into map
  useEffect(() => {
    if (!triageData || triageRunning) return;
    const map = new Map<string, TriageResult>();
    for (const r of triageData) {
      map.set(`${r.file_id}_${r.awp_class_name}`, r);
    }
    setTriageResults(map);
  }, [triageData, triageRunning]);

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

  // Fetch persisted model selections and token count
  const { data: requestMeta } = useQuery({
    queryKey: ["analysis-request-meta", requestId],
    queryFn: async () => {
      const { data } = await supabase
        .from("analysis_requests")
        .select("status, summary_data, triage_tokens_used, analyze_tokens_used, triage_model, analyze_model, disabled_awp_classes")
        .eq("id", requestId)
        .single();
      return data;
    },
    refetchInterval: analyzeV2Running ? 5000 : false,
  });

  // Initialize models and tokens from DB
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
    if (disabled && disabled.length > 0) {
      setDisabledColumns(new Set(disabled));
    }
  }, [requestMeta]);

  // Hydrate analyzeV2Running from DB status on mount/navigation
  // Also auto-clear when DB status transitions to complete while we're showing "running"
  const [hydratedProcessing, setHydratedProcessing] = useState(false);
  const hasTriggeredResumeRef = useRef(false);
  useEffect(() => {
    if (!requestMeta) return;
    const dbStatus = (requestMeta as any).status as string;

    if (!hydratedProcessing) {
      if (dbStatus === "processing") {
        analyzeRunSyncRef.current = "running";
        setAnalyzeV2Running(true);
      } else if (dbStatus === "complete") {
        analyzeRunSyncRef.current = "idle";
        setAnalyzeV2Running(false);
        setAnalyzeV2Stopping(false);
        setAnalyzingClasses(new Set());
        setClassFileStatuses({});
      }
      setHydratedProcessing(true);
      return;
    }

    if (dbStatus === "processing") {
      analyzeRunSyncRef.current = "running";
      if (!analyzeV2Running) {
        setAnalyzeV2Running(true);
      }
      return;
    }

    if (dbStatus === "complete") {
      if (analyzeRunSyncRef.current === "starting") {
        return;
      }

      analyzeRunSyncRef.current = "idle";
      setAnalyzeV2Running(false);
      setAnalyzeV2Stopping(false);
      setAnalyzingClasses(new Set());
      setClassFileStatuses({});
    }
  }, [requestMeta, hydratedProcessing, analyzeV2Running]);

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
              for (const p of enabledPrompts) { handleSummarize(p.awp_class_name); }
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
  const sortedPrompts = useMemo(() => {
    if (!prompts) return [];
    return [...prompts]
      .filter(p => isDrawingDetectable(p))
      .sort((a, b) => {
        const oa = globalOrderMap[a.awp_class_name] ?? 9999;
        const ob = globalOrderMap[b.awp_class_name] ?? 9999;
        return oa - ob;
      });
  }, [prompts, globalOrderMap, isDrawingDetectable]);

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

  const toggleColumnDisabled = async (awpClassName: string) => {
    setDisabledColumns((prev) => {
      const next = new Set(prev);
      if (next.has(awpClassName)) {
        next.delete(awpClassName);
      } else {
        next.add(awpClassName);
      }
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

    // Mark request as processing
    await supabase.from("analysis_requests").update({ status: "processing" }).eq("id", requestId);
    await queryClient.invalidateQueries({ queryKey: ["analysis-request-meta", requestId] });

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
        for (const cn of allClassNames) { handleSummarize(cn); }
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
              for (const cn of allClassNames) { handleSummarize(cn); }
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
        void supabase.from("analysis_requests").update({ status: "complete" }).eq("id", requestId);
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

  const startTriageScheduler = (onComplete: () => void) => {
    triageTimerRef.current = setInterval(() => {
      while (
        inFlightCountRef.current < MAX_CONCURRENT_TRIAGE &&
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
      inFlightCountRef.current < MAX_CONCURRENT_TRIAGE &&
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

    startTriageScheduler(() => {
      queryClient.invalidateQueries({ queryKey: ["triage-results", requestId] });
      setTriagingClasses((prev) => { const next = new Set(prev); next.delete(className); return next; });
      setTriageRunning(false);
      setTriagePhase(null);
    });
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

    startTriageScheduler(() => {
      queryClient.invalidateQueries({ queryKey: ["triage-results", requestId] });
      setTriagingClasses(new Set());
      setTriageRunning(false);
      setTriagePhase(null);
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
    if (result.status === "processing") return "loading";
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
          <div className="px-4 py-3 border-b flex items-center gap-3">
            <div className="flex items-center gap-3">
              {/* Extract Context group */}
              {extractRunning ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground tabular-nums">
                    Extracting: {triageProgress.done}/{triageProgress.total} files
                  </span>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={handleStopExtract}
                    disabled={extractStopping}
                  >
                    {extractStopping ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Square className="w-4 h-4 mr-2" />
                    )}
                    {extractStopping ? "Stopping…" : "Stop"}
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleExtractAll}
                  disabled={triageRunning || anyAnalyzing || copiedFiles.length === 0}
                >
                  <FileSearch className="w-4 h-4 mr-2" />
                  Extract Context
                </Button>
              )}

              {/* Separator */}
              <div className="h-6 w-px bg-border" />

              {/* Triage group */}
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground whitespace-nowrap">Model:</label>
                <select
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                  value={triageModel}
                  onChange={(e) => updateTriageModel(e.target.value)}
                  disabled={triageRunning}
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
              {triageRunning && triagePhase && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  Triaging: {triageProgress.done}/{triageProgress.total} instances
                </span>
              )}
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
              {triageRunning && triageTokens > 0 && (
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
                  {triageStopping ? "Stopping…" : "Stop"}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleTriageAll}
                  disabled={anyAnalyzing || extractRunning || copiedFiles.length === 0}
                >
                  <ScanLine className="w-4 h-4 mr-2" />
                  Triage
                </Button>
              )}

              {/* Separator */}
              <div className="h-6 w-px bg-border" />

              {/* Analyze group */}
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground whitespace-nowrap">Model:</label>
                <select
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                  value={analyzeModel}
                  onChange={(e) => updateAnalyzeModel(e.target.value)}
                  disabled={anyAnalyzing}
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
              {analyzeV2Running && analyzeTokens > 0 && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {analyzeTokens.toLocaleString()} tokens
                </span>
              )}
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
              {analyzeV2Running ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground tabular-nums">
                    Analyzing: {analyzeV2Progress.done}/{analyzeV2Progress.total} instances
                  </span>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={handleStopAnalyzeV2}
                    disabled={analyzeV2Stopping}
                  >
                    {analyzeV2Stopping ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Square className="w-4 h-4 mr-2" />
                    )}
                    {analyzeV2Stopping ? "Stopping…" : "Stop"}
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    onClick={handleAnalyzeAllV2}
                    disabled={anyAnalyzing || triageRunning || extractRunning || copiedFiles.length === 0}
                  >
                    {anyAnalyzing ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Search className="w-4 h-4 mr-2" />
                    )}
                    Analyze
                  </Button>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={handleAnalyzeAll}
                        disabled={anyAnalyzing || triageRunning || extractRunning || copiedFiles.length === 0}
                      >
                        <Search className="w-3.5 h-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Legacy Analyze (class-by-class)</TooltipContent>
                  </Tooltip>
                </div>
              )}
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
                      <span className="block text-sm">
                        Files ({copiedFiles.length} files | {formatBytes(totalSizeBytes)} | {sourceLabel})
                      </span>
                    </th>
                     {sortedPrompts.map((prompt) => {
                      const isDisabled = disabledColumns.has(prompt.awp_class_name);
                      return (
                      <th key={prompt.id} className={`w-14 px-2 py-2 text-center font-medium text-muted-foreground ${isDisabled ? 'opacity-30' : ''}`}>
                        <div className="flex flex-col items-center gap-1">
                          <Checkbox
                            checked={!isDisabled}
                            onCheckedChange={() => toggleColumnDisabled(prompt.awp_class_name)}
                            className="h-3.5 w-3.5"
                          />
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
                        </div>
                      </th>
                      );
                    })}
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
                        const isDisabled = disabledColumns.has(className);
                        const hasTriageResults = copiedFiles.some((f) => triageResults.has(`${f.id}_${className}`));

                        return (
                          <td key={prompt.id} className={`w-14 px-2 py-1.5 text-center ${isDisabled ? 'opacity-30' : ''}`}>
                            {triagingClasses.has(className) && !isDisabled ? (
                              <div className="flex items-center justify-center">
                                <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                              </div>
                            ) : (
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
                           {uploadingFileIds.has(file.id) && !extractingFileIds.has(file.id) && (
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
                          {extractedFileIds.has(file.id) && !extractingFileIds.has(file.id) && (
                            <button
                              className="inline-flex items-center rounded-full border border-emerald-300 bg-emerald-100 px-1.5 py-px text-[10px] font-medium text-emerald-800 leading-tight flex-shrink-0 cursor-pointer hover:bg-emerald-200 transition-colors"
                              onClick={() => setExtractedTextFile(file)}
                            >
                              Processed
                            </button>
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
                          ? { backgroundColor: `rgba(34, 197, 94, ${triageForBg.score / 100})` }
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
                          return (
                            <td key={prompt.id} className={`w-14 px-2 py-2 text-center${disabledCls}`} style={triageBgStyle}>
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

                        if (triage?.status === "processing") {
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
                          let cellClass = `w-14 px-2 py-2 text-center cursor-pointer transition-colors${disabledCls}`;
                          let overrideLabel = "";

                          // Always show triage score background on the cell
                          cellStyle = { backgroundColor: `rgba(34, 197, 94, ${triage.score / 100})` };

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
              <ScanLine className="w-4 h-4 text-primary" />
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
