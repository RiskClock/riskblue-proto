/**
 * Server-side DOCX generation for the analysis export.
 *
 * Node port of `src/lib/analysisDocxExporter.ts`. Preserves the same visible
 * output: detection table per page, cropped drawing with red-circle highlight,
 * proportional sizing constrained to ~620x720pt, filename pattern, source-type
 * bucket routing, AI bbox -> text-layer fallback -> page-only fallback.
 *
 * Browser-only APIs replaced:
 *  - document.createElement("canvas")  -> @napi-rs/canvas
 *  - PDF rendering uses pdfjs-dist legacy build (Node-compatible)
 */

import { SupabaseClient } from "@supabase/supabase-js";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table as DocxTable,
  TableRow as DocxTableRow,
  TableCell as DocxTableCell,
  ImageRun,
  PageBreak,
  BorderStyle,
  WidthType,
  AlignmentType,
  ShadingType,
} from "docx";
import { createCanvas, Canvas, SKRSContext2D } from "@napi-rs/canvas";
// Legacy build for Node. The .mjs file does not auto-set workerSrc and runs
// in fake-worker mode out of the box, which is what we want server-side.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SummarizedInstance {
  id: string;
  name: string;
  floor: string;
  area_sqft: number;
  notes: string;
  pipe_diameter_mm?: number;
}

interface InstanceExportRow {
  detectionNumber: number;
  totalDetections: number;
  displayId: string;
  displayName: string;
  floor: string;
  type: string;
  className: string;
  areaSqft: number;
  pipeDiameterMM?: number;
  controls: string[];
  fileName: string;
  drawingImage: { png: Uint8Array; width: number; height: number } | null;
  drawingWithoutHighlight: boolean;
}

interface GenerateArgs {
  supabase: SupabaseClient;
  summaryData: Record<string, SummarizedInstance[]>;
  projectName: string;
  sourceType: string;
  analysisRequestId: string | null;
}

interface GenerateResult {
  buffer: Buffer;
  filename: string;
}

// ---------------------------------------------------------------------------
// Text normalization + bbox search (ported from src/lib/pdfTextLayerSearch.ts)
// ---------------------------------------------------------------------------

interface PDFBBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  pageNum: number;
}

function normalizeText(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\uFE58\uFE63\uFF0D]/g, "-")
    .replace(/[\u00D8\u00F8\u2205\u2300]/g, "o")
    .replace(/\s+/g, " ");
}

function itemBBox(item: { transform: number[]; width: number; height: number }): [number, number, number, number] {
  const [, , , , tx, ty] = item.transform;
  const iw = Math.abs(item.width);
  const ih = Math.abs(item.height) || 10;
  return [tx, ty, tx + iw, ty + ih];
}

const ROOM_NAME_KEYWORDS = [
  "electrical", "substation", "it room", "telecom", "transformer",
  "generator", "switchgear", "mdf", "idf", "ups", "power",
];

async function findBBoxInTextLayer(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdf: any,
  primaryTag: string,
  hintPageNum?: number,
): Promise<PDFBBox | null> {
  const normTag = normalizeText(primaryTag);
  if (!normTag || normTag.length < 2) return null;

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

    let matchedItem: typeof items[0] | null = null;
    for (const item of items) {
      if (normalizeText(item.str) === normTag) {
        matchedItem = item;
        break;
      }
    }

    if (!matchedItem) {
      for (let i = 0; i < items.length - 1; i++) {
        let concat = "";
        const spanItems: typeof items = [];
        for (let j = i; j < Math.min(i + 4, items.length); j++) {
          const baseY = items[i].transform[5];
          const curY = items[j].transform[5];
          if (Math.abs(curY - baseY) > 4) break;
          concat += items[j].str;
          spanItems.push(items[j]);
          if (normalizeText(concat) === normTag) {
            const [sx1] = itemBBox(spanItems[0]);
            const [, , sx2] = itemBBox(spanItems[spanItems.length - 1]);
            matchedItem = { ...items[i], width: sx2 - sx1 };
            break;
          }
        }
        if (matchedItem) break;
      }
    }

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
    }

    if (!matchedItem) continue;

    const [mx1, my1, mx2, my2] = itemBBox(matchedItem);
    const tagCentreX = (mx1 + mx2) / 2;
    const tagCentreY = (my1 + my2) / 2;

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
      if (dy > 60 || dx > 80) continue;
      if (dy < bestDist) {
        bestDist = dy;
        rnx1 = Math.min(mx1, ix1);
        rny1 = Math.min(my1, iy1);
        rnx2 = Math.max(mx2, ix2);
        rny2 = Math.max(my2, iy2);
        foundRoomName = true;
      }
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

  return null;
}

// ---------------------------------------------------------------------------
// Overlay candidate parsing (ported verbatim from analysisDocxExporter.ts)
// ---------------------------------------------------------------------------

interface OverlayRow {
  candidates: string[];
  pageNum: number;
  aiBBox?: { x1: number; y1: number; x2: number; y2: number };
}

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

function parseOverlayCandidates(resultText: string): OverlayRow[] {
  try {
    const lines = resultText.split("\n").filter((l) => l.includes("|"));
    if (lines.length < 2) return [];

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
      let aiBBox: OverlayRow["aiBBox"] = undefined;
      if (bboxCol !== -1) {
        const bboxStr = cells[bboxCol] || "";
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

function findMatchingOverlayRow(rows: OverlayRow[], targetId: string): OverlayRow | undefined {
  return rows.find((row) => row.candidates.some((c) => matchesDetectionId(c, targetId)))
    ?? rows.find((row) => row.candidates.some((c) => matchesDetectionId(c, targetId, true)));
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
// Domain helpers (Supabase lookups)
// ---------------------------------------------------------------------------

async function resolveCategory(supabase: SupabaseClient, awpClassName: string): Promise<string> {
  const { data: a } = await supabase.from("critical_assets").select("name").eq("name", awpClassName).maybeSingle();
  if (a) return "Critical Asset";
  const { data: w } = await supabase.from("water_systems").select("name").eq("name", awpClassName).maybeSingle();
  if (w) return "Water System";
  const { data: p } = await supabase.from("processes").select("name").eq("name", awpClassName).maybeSingle();
  if (p) return "Process";
  return "Asset";
}

async function fetchControlNames(
  supabase: SupabaseClient,
  awpClassName: string,
  category: string,
): Promise<string[]> {
  const sourceTable =
    category === "Critical Asset" ? "critical_assets" :
    category === "Water System" ? "water_systems" : "processes";

  const { data: sourceEntry } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from(sourceTable as any)
    .select("default_control_ids")
    .eq("name", awpClassName)
    .maybeSingle();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controlIds = (sourceEntry as any)?.default_control_ids;
  if (!controlIds?.length) return [];

  const { data: controls } = await supabase
    .from("mitigation_controls")
    .select("name")
    .in("id", controlIds);

  return controls?.map((c: { name: string }) => c.name) || [];
}

async function findSourceFile(
  supabase: SupabaseClient,
  requestId: string,
  awpClassName: string,
  instanceId: string,
  files: Array<{ id: string; name: string; storage_path: string | null }>,
): Promise<{ fileName: string; storagePath: string | null }> {
  const { data: results } = await supabase
    .from("analysis_results")
    .select("file_id, result_text")
    .eq("analysis_request_id", requestId)
    .eq("awp_class_name", awpClassName)
    .eq("status", "complete");

  if (results) {
    for (const r of results as Array<{ file_id: string; result_text: string | null }>) {
      if (r.result_text && r.result_text.includes(instanceId)) {
        const file = files.find((f) => f.id === r.file_id);
        if (file) return { fileName: file.name, storagePath: file.storage_path };
      }
    }
  }
  if (files.length > 0) {
    return { fileName: files[0].name, storagePath: files[0].storage_path };
  }
  return { fileName: "Unknown", storagePath: null };
}

// ---------------------------------------------------------------------------
// PDF rendering with @napi-rs/canvas + pdfjs-dist legacy
// ---------------------------------------------------------------------------

const EXPORT_SCALE = 1.5;

// ---- Page geometry (US Letter, 1" margins) ---------------------------------
// 1 inch = 1440 DXA = 96 px (at 96 DPI, which is what docx@9 uses for ImageRun).
// Page content area: (12240 - 1440 - 1440) x (15840 - 1440 - 1440) DXA
//                  = 9360 x 12960 DXA  =  6.5" x 9.0"  =  624 x 864 px.
const PAGE_CONTENT_HEIGHT_PX = 864; // 9.0" content height at 96 DPI
const MAX_IMG_W_PX = 620;           // ~6.45" — fits in 6.5" content width

// ---- Per-row vertical budget (used to size the drawing) --------------------
// Info table = 9 rows. Each row ≈ 22 px (font 9pt × line height + 60+60 DXA top/bot
// margins ≈ 8 px padding). Real-world Word render measured at ~21–24 px per row;
// we round up.
const TABLE_ROW_HEIGHT_PX = 24;
const TABLE_ROW_COUNT = 9;
const ESTIMATED_TABLE_HEIGHT_PX = TABLE_ROW_HEIGHT_PX * TABLE_ROW_COUNT; // 216 px
const SPACER_HEIGHT_PX = 14;        // Paragraph with 200 DXA before-spacing ≈ 14 px
const CAPTION_HEIGHT_PX = 22;       // Italic 8pt note (only when no highlight)
const SAFETY_BUFFER_PX = 32;        // Guards against Word's renderer rounding

// Hard ceiling so a single drawing never exceeds the page even if the table
// estimate is off. Equal to content height minus the smallest plausible table.
const MAX_IMG_H_PX_HARD_CAP = PAGE_CONTENT_HEIGHT_PX - ESTIMATED_TABLE_HEIGHT_PX
  - SPACER_HEIGHT_PX - SAFETY_BUFFER_PX; // = 864 - 216 - 14 - 32 = 602 px

function computeAvailableImageHeightPx(hasCaption: boolean): number {
  const captionPx = hasCaption ? CAPTION_HEIGHT_PX : 0;
  const available = PAGE_CONTENT_HEIGHT_PX
    - ESTIMATED_TABLE_HEIGHT_PX
    - SPACER_HEIGHT_PX
    - captionPx
    - SAFETY_BUFFER_PX;
  return Math.max(120, Math.min(available, MAX_IMG_H_PX_HARD_CAP));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PdfCache = Map<string, any>;

async function loadPdf(
  supabase: SupabaseClient,
  storagePath: string,
  bucket: string,
  cache: PdfCache,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  if (cache.has(storagePath)) return cache.get(storagePath);
  try {
    const { data: fileData, error } = await supabase.storage.from(bucket).download(storagePath);
    if (error || !fileData) {
      cache.set(storagePath, null);
      return null;
    }
    const arrayBuffer = await fileData.arrayBuffer();
    // disableWorker keeps everything on the main thread (Node-friendly).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdf = await (pdfjsLib as any).getDocument({
      data: new Uint8Array(arrayBuffer),
      disableWorker: true,
      isEvalSupported: false,
      useSystemFonts: true,
    }).promise;
    cache.set(storagePath, pdf);
    return pdf;
  } catch (e) {
    console.warn("Failed to load PDF for export:", storagePath, e);
    cache.set(storagePath, null);
    return null;
  }
}

function drawHighlightCircle(
  ctx: SKRSContext2D,
  cx: number,
  cy: number,
  diameter: number,
): void {
  ctx.beginPath();
  ctx.arc(cx, cy, diameter / 2, 0, 2 * Math.PI);
  ctx.fillStyle = "rgba(220, 38, 38, 0.22)";
  ctx.fill();
  ctx.strokeStyle = "rgb(220, 38, 38)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

async function renderDrawingImage(
  supabase: SupabaseClient,
  storagePath: string | null,
  instance: SummarizedInstance,
  resultText: string | null,
  sourceType: string | undefined,
  pdfCache: PdfCache,
): Promise<{ png: Uint8Array; width: number; height: number; hasHighlight: boolean } | null> {
  if (!storagePath) return null;

  const bucket = sourceType === "manual_upload" ? "uploaded-drawings" : "drive-analysis-files";

  try {
    const pdf = await loadPdf(supabase, storagePath, bucket, pdfCache);
    if (!pdf) return null;

    const rows = resultText ? parseOverlayCandidates(resultText) : [];
    const matchingRow = findMatchingOverlayRow(rows, instance.id);
    const hintPage = matchingRow?.pageNum;
    const aiBBox = matchingRow?.aiBBox;
    const searchCandidates = buildOverlaySearchCandidates(matchingRow, instance);

    let pageNum = 1;
    let bbox: [number, number, number, number] | null = null;
    let coordSpace: "pixels" | "pdf-points" = "pixels";
    let aiViewportWidth = 0;
    let pageResolved = false;

    if (aiBBox) {
      pageNum = Math.min(hintPage ?? 1, pdf.numPages);
      bbox = [aiBBox.x1, aiBBox.y1, aiBBox.x2, aiBBox.y2];
      coordSpace = "pixels";
      const refPage = await pdf.getPage(pageNum);
      const refVp = refPage.getViewport({ scale: 4 });
      aiViewportWidth = refVp.width;
      pageResolved = true;
    } else {
      let textBBox: PDFBBox | null = null;
      for (const candidate of searchCandidates) {
        textBBox = await findBBoxInTextLayer(pdf, candidate, hintPage);
        if (textBBox) break;
      }
      if (textBBox) {
        pageNum = Math.min(textBBox.pageNum, pdf.numPages);
        bbox = [textBBox.x1, textBBox.y1, textBBox.x2, textBBox.y2];
        coordSpace = "pdf-points";
        pageResolved = true;
      } else if (hintPage) {
        pageNum = Math.min(hintPage, pdf.numPages);
        bbox = null;
        pageResolved = true;
      } else {
        return null;
      }
    }

    if (!pageResolved) return null;

    const page = await pdf.getPage(pageNum);
    const exportViewport = page.getViewport({ scale: EXPORT_SCALE });

    const sourceCanvas: Canvas = createCanvas(
      Math.ceil(exportViewport.width),
      Math.ceil(exportViewport.height),
    );
    const sourceCtx = sourceCanvas.getContext("2d");

    // pdf.js types expect a CanvasRenderingContext2D; @napi-rs/canvas SKRSContext2D
    // is API-compatible at runtime for the operations pdf.js uses.
    await page.render({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      canvasContext: sourceCtx as any,
      viewport: exportViewport,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      canvas: sourceCanvas as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).promise;

    let circle: { cx: number; cy: number; diameter: number } | null = null;
    if (bbox) {
      const [x1, y1, x2, y2] = bbox;
      let cx: number, cy: number, side: number;
      if (coordSpace === "pixels") {
        const k = exportViewport.width / aiViewportWidth;
        cx = ((x1 + x2) / 2) * k;
        cy = ((y1 + y2) / 2) * k;
        side = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) * k;
      } else {
        const [vx1, vy1, vx2, vy2] = exportViewport.convertToViewportRectangle([x1, y1, x2, y2]);
        cx = (vx1 + vx2) / 2;
        cy = (vy1 + vy2) / 2;
        side = Math.max(Math.abs(vx2 - vx1), Math.abs(vy2 - vy1));
      }
      const diameter = Math.max(34, side * 1.5);
      circle = { cx, cy, diameter };
    }

    let finalCanvas: Canvas;
    if (circle) {
      const TARGET_DIAMETER_RATIO = 0.20;
      const MIN_DIAMETER_RATIO = 0.25;
      const MAX_DIAMETER_RATIO = 0.15;
      const TARGET_ASPECT_W_OVER_H = MAX_IMG_W_PX / MAX_IMG_H_PX;

      let cropW = circle.diameter / TARGET_DIAMETER_RATIO;
      cropW = Math.max(cropW, circle.diameter * 6);
      const minCropFromMaxRatio = circle.diameter / MIN_DIAMETER_RATIO;
      const maxCropFromMinRatio = circle.diameter / MAX_DIAMETER_RATIO;
      cropW = Math.max(cropW, minCropFromMaxRatio);
      cropW = Math.min(cropW, maxCropFromMinRatio);

      let cropH = cropW / TARGET_ASPECT_W_OVER_H;

      if (cropW >= sourceCanvas.width && cropH >= sourceCanvas.height) {
        finalCanvas = sourceCanvas;
        const ctx = sourceCanvas.getContext("2d");
        drawHighlightCircle(ctx, circle.cx, circle.cy, circle.diameter);
      } else {
        cropW = Math.min(cropW, sourceCanvas.width);
        cropH = Math.min(cropH, sourceCanvas.height);

        let cropX = circle.cx - cropW / 2;
        let cropY = circle.cy - cropH / 2;
        cropX = Math.max(0, Math.min(cropX, sourceCanvas.width - cropW));
        cropY = Math.max(0, Math.min(cropY, sourceCanvas.height - cropH));

        const cropped: Canvas = createCanvas(Math.round(cropW), Math.round(cropH));
        const croppedCtx = cropped.getContext("2d");
        croppedCtx.drawImage(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          sourceCanvas as any,
          cropX, cropY, cropW, cropH,
          0, 0, cropW, cropH,
        );
        drawHighlightCircle(
          croppedCtx,
          circle.cx - cropX,
          circle.cy - cropY,
          circle.diameter,
        );
        finalCanvas = cropped;
      }
    } else {
      finalCanvas = sourceCanvas;
    }

    const png = finalCanvas.toBuffer("image/png");
    return {
      png: new Uint8Array(png),
      width: finalCanvas.width,
      height: finalCanvas.height,
      hasHighlight: bbox !== null,
    };
  } catch (e) {
    console.warn("Failed to render drawing for export:", e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main entrypoint
// ---------------------------------------------------------------------------

export async function generateExportDocx(args: GenerateArgs): Promise<GenerateResult> {
  const { supabase, summaryData, projectName, sourceType, analysisRequestId } = args;

  // Filename: RiskBlue {Project_Name_With_Underscores} Assets and Systems Export {YYYYMMDD}.docx
  const safeName = (projectName || "Project")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const now = new Date();
  const yyyymmdd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const filename = `RiskBlue ${safeName} Assets and Systems Export ${yyyymmdd}.docx`;

  // 1. Load files for this analysis request (if we have one). Without a
  //    request ID we still emit the table-only document — drawings will be
  //    skipped because there are no source files.
  let files: Array<{ id: string; name: string; storage_path: string | null }> = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let allResults: Array<{ file_id: string; awp_class_name: string; result_text: string | null; status: string }> = [];

  if (analysisRequestId) {
    const { data: filesData } = await supabase
      .from("analysis_request_files")
      .select("id, name, storage_path")
      .eq("analysis_request_id", analysisRequestId);
    files = filesData || [];

    const { data: resultsData } = await supabase
      .from("analysis_results")
      .select("file_id, awp_class_name, result_text, status")
      .eq("analysis_request_id", analysisRequestId)
      .eq("status", "complete");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    allResults = (resultsData as any) || [];
  }

  // 2. AWP id_prefix lookup
  const [aData, wData, pData] = await Promise.all([
    supabase.from("critical_assets").select("name, id_prefix").eq("is_active", true),
    supabase.from("water_systems").select("name, id_prefix").eq("is_active", true),
    supabase.from("processes").select("name, id_prefix").eq("is_active", true),
  ]);
  const prefixMap: Record<string, string> = {};
  for (const x of [
    ...(aData.data || []),
    ...(wData.data || []),
    ...(pData.data || []),
  ] as Array<{ name: string; id_prefix: string | null }>) {
    if (x.id_prefix) prefixMap[x.name] = x.id_prefix;
  }

  // 3. Flatten instances
  const allInstances: Array<{ awpClassName: string; instance: SummarizedInstance }> = [];
  for (const [className, instances] of Object.entries(summaryData)) {
    if (!Array.isArray(instances)) continue;
    for (const inst of instances) {
      allInstances.push({ awpClassName: className, instance: inst });
    }
  }

  const totalDetections = allInstances.length;
  if (totalDetections === 0) {
    throw new Error("No detection instances to export");
  }

  // 4. Build rows
  const rows: InstanceExportRow[] = [];
  const categoryCache: Record<string, string> = {};
  const controlsCache: Record<string, string[]> = {};
  const pdfCache: PdfCache = new Map();

  for (let i = 0; i < allInstances.length; i++) {
    const { awpClassName, instance } = allInstances[i];

    if (!categoryCache[awpClassName]) {
      categoryCache[awpClassName] = await resolveCategory(supabase, awpClassName);
    }
    const type = categoryCache[awpClassName];

    if (!controlsCache[awpClassName]) {
      controlsCache[awpClassName] = await fetchControlNames(supabase, awpClassName, type);
    }
    const controls = controlsCache[awpClassName];

    const sourceFile = analysisRequestId
      ? await findSourceFile(supabase, analysisRequestId, awpClassName, instance.id, files)
      : { fileName: "Unknown", storagePath: null };

    let resultText: string | null = null;
    for (const r of allResults) {
      if (r.awp_class_name === awpClassName && r.result_text?.includes(instance.id)) {
        resultText = r.result_text;
        break;
      }
    }

    const drawingImage = await renderDrawingImage(
      supabase,
      sourceFile.storagePath,
      instance,
      resultText,
      sourceType,
      pdfCache,
    );

    rows.push({
      detectionNumber: i + 1,
      totalDetections,
      displayId: instance.id,
      displayName: instance.name,
      floor: instance.floor || "—",
      type,
      className: awpClassName,
      areaSqft: instance.area_sqft,
      pipeDiameterMM: instance.pipe_diameter_mm,
      controls,
      fileName: sourceFile.fileName,
      drawingImage: drawingImage
        ? { png: drawingImage.png, width: drawingImage.width, height: drawingImage.height }
        : null,
      drawingWithoutHighlight: !!drawingImage && !drawingImage.hasHighlight,
    });
  }

  // 5. Build DOCX
  const cellBorder = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
  const cellBorders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };
  const labelWidth = 2800;
  const valueWidth = 6560;

  const buildInfoRow = (label: string, value: string) =>
    new DocxTableRow({
      cantSplit: true,
      children: [
        new DocxTableCell({
          borders: cellBorders,
          width: { size: labelWidth, type: WidthType.DXA },
          shading: { fill: "F0F4F8", type: ShadingType.CLEAR },
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
          children: [
            new Paragraph({
              children: [new TextRun({ text: label, bold: true, size: 18, font: "Arial" })],
            }),
          ],
        }),
        new DocxTableCell({
          borders: cellBorders,
          width: { size: valueWidth, type: WidthType.DXA },
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
          children: [
            new Paragraph({
              children: [new TextRun({ text: value, size: 18, font: "Arial" })],
            }),
          ],
        }),
      ],
    });

  const sections = rows.map((row, idx) => {
    const isPipe = (row.pipeDiameterMM && row.pipeDiameterMM > 0);
    const sizeLabel = isPipe ? "Diameter" : "Area (sqft)";
    const sizeValue = isPipe
      ? `${Math.round(row.pipeDiameterMM!)} mm (${(row.pipeDiameterMM! / 25.4).toFixed(1)}″)`
      : row.areaSqft > 0
        ? String(row.areaSqft)
        : "—";

    const controlsValue = row.controls.length > 0 ? row.controls.join(", ") : "—";

    const tableElement = new DocxTable({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [labelWidth, valueWidth],
      rows: [
        buildInfoRow("Detection", `${row.detectionNumber} of ${row.totalDetections}`),
        buildInfoRow("Display ID", row.displayId),
        buildInfoRow("Display Name", row.displayName),
        buildInfoRow("Floor", row.floor),
        buildInfoRow("Type", row.type),
        buildInfoRow("Class", row.className),
        buildInfoRow(sizeLabel, sizeValue),
        buildInfoRow("Controls", controlsValue),
        buildInfoRow("File", row.fileName),
      ],
    });

    const children: (Paragraph | DocxTable)[] = [];

    if (idx > 0) {
      children.push(new Paragraph({ children: [new PageBreak()] }));
    }

    children.push(tableElement);

    if (row.drawingImage) {
      children.push(
        new Paragraph({
          spacing: { before: 200 },
          keepNext: true,
        }),
      );

      const ratio = row.drawingImage.width / row.drawingImage.height;
      let w = MAX_IMG_W_PX;
      let h = MAX_IMG_W_PX / ratio;
      if (h > MAX_IMG_H_PX) {
        h = MAX_IMG_H_PX;
        w = MAX_IMG_H_PX * ratio;
      }

      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          keepLines: true,
          children: [
            new ImageRun({
              type: "png",
              data: row.drawingImage.png,
              transformation: { width: Math.round(w), height: Math.round(h) },
              altText: {
                title: `Drawing for ${row.displayId}`,
                description: `Source drawing showing ${row.displayName} detection`,
                name: `drawing-${row.displayId}`,
              },
            }),
          ],
        }),
      );

      if (row.drawingWithoutHighlight) {
        children.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 80 },
            children: [
              new TextRun({
                text: "Drawing shown without highlight because export could not resolve the exact detection bounds.",
                italics: true,
                size: 16,
                color: "666666",
                font: "Arial",
              }),
            ],
          }),
        );
      }
    }

    return children;
  });

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: "Arial", size: 20 } },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        children: sections.flat(),
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  return { buffer, filename };
}
