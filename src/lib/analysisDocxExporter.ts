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
import { supabase } from "@/integrations/supabase/client";
import * as pdfjsLib from "pdfjs-dist";
import { findBBoxInTextLayer, normalizeText } from "@/lib/pdfTextLayerSearch";
import { resolveDocumentSource } from "@/components/viewer";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ExportStage =
  | "initializing"
  | "loading"
  | "rendering"
  | "packing"
  | "downloading";

export interface ExportProgress {
  stage: ExportStage;
  /** 0..100 percentage to display in the UI */
  percent: number;
  /** Status text e.g. "Processing detection 7 of 22" */
  detail?: string;
  /** Detection-level counters when available */
  done?: number;
  total?: number;
}

export interface GenerateOptions {
  onProgress?: (p: ExportProgress) => void;
  signal?: AbortSignal;
  sourceType?: string;
}

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

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

export class ExportAbortError extends Error {
  constructor() {
    super("Export cancelled by user.");
    this.name = "ExportAbortError";
  }
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ExportAbortError();
}

/** Yield to the event loop so the UI stays responsive between detections. */
function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ---------------------------------------------------------------------------
// Overlay helpers - kept identical to viewer logic.
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
        const bboxMatch = bboxStr.match(/\(?\s*(\d+)[,\s]+(\d+)\s*\)?\s*(?:→|->|-|–)\s*\(?\s*(\d+)[,\s]+(\d+)\s*\)?/);
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
// Domain helpers
// ---------------------------------------------------------------------------

async function resolveCategory(awpClassName: string): Promise<string> {
  const { data: a } = await supabase.from("critical_assets").select("name").eq("name", awpClassName).maybeSingle();
  if (a) return "Critical Asset";
  const { data: w } = await supabase.from("water_systems").select("name").eq("name", awpClassName).maybeSingle();
  if (w) return "Water System";
  const { data: p } = await supabase.from("processes").select("name").eq("name", awpClassName).maybeSingle();
  if (p) return "Process";
  return "Asset";
}

async function fetchControlNames(awpClassName: string, category: string): Promise<string[]> {
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

  return controls?.map((c) => c.name) || [];
}

async function findSourceFile(
  requestId: string,
  awpClassName: string,
  instanceId: string,
  files: Array<{ id: string; name: string; storage_path: string | null }>
): Promise<{ fileName: string; storagePath: string | null }> {
  const { data: results } = await supabase
    .from("analysis_results")
    .select("file_id, result_text")
    .eq("analysis_request_id", requestId)
    .eq("awp_class_name", awpClassName)
    .eq("status", "complete");

  if (results) {
    for (const r of results) {
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
// Page geometry - US Letter, 1" margins, 96 DPI.
//   Content area = 6.5" × 9" = 624 × 864 px.
// ---------------------------------------------------------------------------

const EXPORT_SCALE = 1.5;
const PAGE_CONTENT_HEIGHT_PX = 864;
const MAX_IMG_W_PX = 620;

const TABLE_ROW_BASE_HEIGHT_PX = 30;
const TABLE_ROW_COUNT = 9;
const TABLE_VALUE_CHARS_PER_LINE = 75;
const TABLE_WRAP_LINE_HEIGHT_PX = 14;
const TABLE_BASE_HEIGHT_PX = TABLE_ROW_BASE_HEIGHT_PX * TABLE_ROW_COUNT;

const SPACER_HEIGHT_PX = 14;
const CAPTION_HEIGHT_PX = 22;
const SAFETY_BUFFER_PX = 32;

// 864 - 270 - 14 - 32 = 548 px
const MAX_IMG_H_PX_HARD_CAP =
  PAGE_CONTENT_HEIGHT_PX - TABLE_BASE_HEIGHT_PX - SPACER_HEIGHT_PX - SAFETY_BUFFER_PX;

function estimateValueExtraHeightPx(value: string): number {
  if (!value) return 0;
  const lines = Math.ceil(value.length / TABLE_VALUE_CHARS_PER_LINE);
  return Math.max(0, lines - 1) * TABLE_WRAP_LINE_HEIGHT_PX;
}

function estimateTableHeightPx(args: {
  controlsValue: string;
  fileName: string;
  displayName: string;
  className: string;
}): number {
  return (
    TABLE_BASE_HEIGHT_PX +
    estimateValueExtraHeightPx(args.controlsValue) +
    estimateValueExtraHeightPx(args.fileName) +
    estimateValueExtraHeightPx(args.displayName) +
    estimateValueExtraHeightPx(args.className)
  );
}

function computeAvailableImageHeightPx(
  hasCaption: boolean,
  estimatedTableHeightPx: number,
): number {
  const captionPx = hasCaption ? CAPTION_HEIGHT_PX : 0;
  const available =
    PAGE_CONTENT_HEIGHT_PX - estimatedTableHeightPx - SPACER_HEIGHT_PX - captionPx - SAFETY_BUFFER_PX;
  return Math.max(120, Math.min(available, MAX_IMG_H_PX_HARD_CAP));
}

// ---------------------------------------------------------------------------
// Drawing render (browser, viewer-parity overlay + red translucent circle)
// ---------------------------------------------------------------------------

type PdfCache = Map<string, pdfjsLib.PDFDocumentProxy | null>;

async function loadPdf(
  storagePath: string,
  bucket: string,
  cache: PdfCache,
  signal?: AbortSignal,
): Promise<pdfjsLib.PDFDocumentProxy | null> {
  checkAbort(signal);
  if (cache.has(storagePath)) return cache.get(storagePath)!;
  try {
    // Route through the shared document cache (memory + IndexedDB) so we
    // never re-egress a PDF that the viewer or a prior export already loaded.
    const { blob } = await resolveDocumentSource({
      kind: "supabase-storage",
      bucket,
      path: storagePath,
      mimeType: "application/pdf",
    });
    checkAbort(signal);
    const arrayBuffer = await blob.arrayBuffer();
    checkAbort(signal);
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    cache.set(storagePath, pdf);
    return pdf;
  } catch (e) {
    console.warn("Failed to load PDF for export:", storagePath, e);
    cache.set(storagePath, null);
    return null;
  }
}

function drawHighlightCircle(
  ctx: CanvasRenderingContext2D,
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

/**
 * Draw a thin black border inset along the canvas edges so the image has a
 * clear visual boundary in the DOCX. Stroking with `inside` alignment is not
 * available on canvas, so we offset by half the line width.
 */
function drawImageBorder(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  // Scale border thickness with image size; clamp to a sensible range.
  const lineWidth = Math.max(2, Math.min(4, Math.round(canvas.width / 600)));
  const inset = lineWidth / 2;
  ctx.save();
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = "rgb(0, 0, 0)";
  ctx.strokeRect(
    inset,
    inset,
    canvas.width - lineWidth,
    canvas.height - lineWidth,
  );
  ctx.restore();
}

async function renderDrawingImage(
  storagePath: string | null,
  instance: SummarizedInstance,
  resultText: string | null,
  sourceType: string | undefined,
  pdfCache: PdfCache,
  signal?: AbortSignal,
): Promise<{ png: Uint8Array; width: number; height: number; hasHighlight: boolean } | null> {
  if (!storagePath) return null;

  const bucket = sourceType === "manual_upload" ? "uploaded-drawings" : "drive-analysis-files";

  try {
    const pdf = await loadPdf(storagePath, bucket, pdfCache, signal);
    if (!pdf) return null;
    checkAbort(signal);

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
      // Occurrence index: how many earlier rows on the same page share the
      // same primary candidate text. Disambiguates duplicate-text rows.
      let occurrenceIndex = 0;
      if (matchingRow) {
        const primary = matchingRow.candidates[0];
        const key = primary ? normalizeText(primary) : "";
        if (key) {
          const matchIdx = rows.indexOf(matchingRow);
          for (let i = 0; i < matchIdx; i++) {
            const r = rows[i];
            if (r.pageNum !== matchingRow.pageNum) continue;
            if (r.candidates[0] && normalizeText(r.candidates[0]) === key) occurrenceIndex++;
          }
        }
      }

      let textBBox = null as null | { x1: number; y1: number; x2: number; y2: number; pageNum: number };
      for (const candidate of searchCandidates) {
        checkAbort(signal);
        textBBox = await findBBoxInTextLayer(pdf, candidate, hintPage, occurrenceIndex);
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
    checkAbort(signal);

    const page = await pdf.getPage(pageNum);
    const exportViewport = page.getViewport({ scale: EXPORT_SCALE });

    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = exportViewport.width;
    sourceCanvas.height = exportViewport.height;
    const sourceCtx = sourceCanvas.getContext("2d")!;

    await page.render({ canvasContext: sourceCtx, viewport: exportViewport, canvas: sourceCanvas } as any).promise;
    checkAbort(signal);

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

    let finalCanvas: HTMLCanvasElement;
    if (circle) {
      // Looser crop: red circle ≈ 10% of cropped image width (preferred),
      // clamped between 8% (loosest, more context) and 12% (tightest).
      // crop width = circleDiameter / TARGET_DIAMETER_RATIO
      const TARGET_DIAMETER_RATIO = 0.10;
      const MIN_DIAMETER_RATIO = 0.12; // tightest allowed → smallest crop
      const MAX_DIAMETER_RATIO = 0.08; // loosest allowed → largest crop
      // Match worst-case page budget so all crops have a consistent shape.
      const TARGET_ASPECT_W_OVER_H = MAX_IMG_W_PX / MAX_IMG_H_PX_HARD_CAP;

      let cropW = circle.diameter / TARGET_DIAMETER_RATIO;
      cropW = Math.max(cropW, circle.diameter * 6);
      const minCropFromMaxRatio = circle.diameter / MIN_DIAMETER_RATIO;
      const maxCropFromMinRatio = circle.diameter / MAX_DIAMETER_RATIO;
      cropW = Math.max(cropW, minCropFromMaxRatio);
      cropW = Math.min(cropW, maxCropFromMinRatio);

      let cropH = cropW / TARGET_ASPECT_W_OVER_H;

      if (cropW >= sourceCanvas.width && cropH >= sourceCanvas.height) {
        finalCanvas = sourceCanvas;
        const ctx = sourceCanvas.getContext("2d")!;
        drawHighlightCircle(ctx, circle.cx, circle.cy, circle.diameter);
      } else {
        cropW = Math.min(cropW, sourceCanvas.width);
        cropH = Math.min(cropH, sourceCanvas.height);

        let cropX = circle.cx - cropW / 2;
        let cropY = circle.cy - cropH / 2;
        cropX = Math.max(0, Math.min(cropX, sourceCanvas.width - cropW));
        cropY = Math.max(0, Math.min(cropY, sourceCanvas.height - cropH));

        const cropped = document.createElement("canvas");
        cropped.width = Math.round(cropW);
        cropped.height = Math.round(cropH);
        const croppedCtx = cropped.getContext("2d")!;
        croppedCtx.drawImage(
          sourceCanvas,
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

    // Draw a thin black border around the final image so it has a clear
    // visual boundary in the DOCX. Only the drawing is bordered - never the
    // detection table.
    drawImageBorder(finalCanvas);

    const blob = await new Promise<Blob | null>((resolve) =>
      finalCanvas.toBlob((b) => resolve(b), "image/png", 0.85)
    );
    checkAbort(signal);
    if (!blob) return null;
    const png = new Uint8Array(await blob.arrayBuffer());
    return { png, width: finalCanvas.width, height: finalCanvas.height, hasHighlight: bbox !== null };
  } catch (e) {
    console.warn("Failed to render drawing for export:", e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Filename
// ---------------------------------------------------------------------------

/** RiskBlue {Project_Name_With_Underscores} Assets and Systems Export {YYYYMMDD}.docx */
export function buildExportFilename(projectName: string, date: Date = new Date()): string {
  const safeName = (projectName || "Project")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const yyyymmdd =
    `${date.getFullYear()}` +
    `${String(date.getMonth() + 1).padStart(2, "0")}` +
    `${String(date.getDate()).padStart(2, "0")}`;
  return `RiskBlue ${safeName} Assets and Systems Export ${yyyymmdd}.docx`;
}

// ---------------------------------------------------------------------------
// Main entrypoint
// ---------------------------------------------------------------------------

/**
 * Generate a DOCX export Blob in the browser.
 *
 * Progress allocation (matches the spec):
 *   0–5%   initializing
 *   5–10%  loading export data
 *   10–85% rendering detections
 *   85–95% packing DOCX
 *   95–100% triggering download
 *
 * Throws ExportAbortError if `signal` is aborted.
 */
export async function generateAnalysisDocx(
  requestId: string,
  summaryData: Record<string, SummarizedInstance[]>,
  projectName: string,
  options: GenerateOptions = {},
): Promise<Blob> {
  const { onProgress, signal, sourceType } = options;

  const report = (p: ExportProgress) => onProgress?.(p);

  report({ stage: "initializing", percent: 2, detail: "Preparing export…" });
  checkAbort(signal);

  // 1. Gather all files for this request
  report({ stage: "loading", percent: 6, detail: "Loading export data…" });
  const { data: filesData } = await supabase
    .from("analysis_request_files")
    .select("id, name, storage_path")
    .eq("analysis_request_id", requestId);
  const files = filesData || [];
  checkAbort(signal);

  // 2. Gather all analysis results for matching
  const { data: allResults } = await supabase
    .from("analysis_results")
    .select("file_id, awp_class_name, result_text, status")
    .eq("analysis_request_id", requestId)
    .eq("status", "complete");
  checkAbort(signal);

  // 3. Collect AWP id_prefix lookup
  const [aData, wData, pData] = await Promise.all([
    supabase.from("critical_assets").select("name, id_prefix").eq("is_active", true),
    supabase.from("water_systems").select("name, id_prefix").eq("is_active", true),
    supabase.from("processes").select("name, id_prefix").eq("is_active", true),
  ]);
  const prefixMap: Record<string, string> = {};
  for (const x of [...(aData.data || []), ...(wData.data || []), ...(pData.data || [])]) {
    if (x.id_prefix) prefixMap[x.name] = x.id_prefix;
  }
  checkAbort(signal);

  // 4. Flatten all instances
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

  report({
    stage: "rendering",
    percent: 10,
    detail: `Processing detection 0 of ${totalDetections}`,
    done: 0,
    total: totalDetections,
  });

  // 5. Build export rows - yield between detections so the UI stays responsive.
  const rows: InstanceExportRow[] = [];
  const categoryCache: Record<string, string> = {};
  const controlsCache: Record<string, string[]> = {};
  const pdfCache: PdfCache = new Map();

  for (let i = 0; i < allInstances.length; i++) {
    checkAbort(signal);
    const { awpClassName, instance } = allInstances[i];

    if (!categoryCache[awpClassName]) {
      categoryCache[awpClassName] = await resolveCategory(awpClassName);
    }
    const type = categoryCache[awpClassName];

    if (!controlsCache[awpClassName]) {
      controlsCache[awpClassName] = await fetchControlNames(awpClassName, type);
    }
    const controls = controlsCache[awpClassName];

    const sourceFile = await findSourceFile(requestId, awpClassName, instance.id, files);

    let resultText: string | null = null;
    if (allResults) {
      for (const r of allResults) {
        if (r.awp_class_name === awpClassName && r.result_text?.includes(instance.id)) {
          resultText = r.result_text;
          break;
        }
      }
    }

    const drawingImage = await renderDrawingImage(
      sourceFile.storagePath,
      instance,
      resultText,
      sourceType,
      pdfCache,
      signal,
    );

    rows.push({
      detectionNumber: i + 1,
      totalDetections,
      displayId: instance.id,
      displayName: instance.name,
      floor: instance.floor || "-",
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

    const completed = i + 1;
    const percent = 10 + (completed / totalDetections) * 75;
    report({
      stage: "rendering",
      percent,
      detail: `Processing detection ${completed} of ${totalDetections}`,
      done: completed,
      total: totalDetections,
    });

    // Yield to the browser between detections.
    await yieldToBrowser();
  }

  // 6. Build DOCX
  report({ stage: "packing", percent: 88, detail: "Packing DOCX…" });
  checkAbort(signal);

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
        : "-";

    const controlsValue = row.controls.length > 0 ? row.controls.join(", ") : "-";

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

    // Hard guarantee: every detection after the first starts on a new page.
    if (idx > 0) {
      children.push(new Paragraph({ children: [new PageBreak()] }));
    }

    children.push(tableElement);

    if (row.drawingImage) {
      children.push(
        new Paragraph({
          spacing: { before: 200 },
          keepNext: true,
        })
      );

      // Per-row, content-aware image height budget.
      const estimatedTableHeightPx = estimateTableHeightPx({
        controlsValue,
        fileName: row.fileName,
        displayName: row.displayName,
        className: row.className,
      });
      const availableImageHeightPx = computeAvailableImageHeightPx(
        row.drawingWithoutHighlight,
        estimatedTableHeightPx,
      );
      const ratio = row.drawingImage.width / row.drawingImage.height;
      let w = MAX_IMG_W_PX;
      let h = MAX_IMG_W_PX / ratio;
      if (h > availableImageHeightPx) {
        h = availableImageHeightPx;
        w = availableImageHeightPx * ratio;
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
        })
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
          })
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

  checkAbort(signal);
  const blob = await Packer.toBlob(doc);
  report({ stage: "downloading", percent: 96, detail: "Starting download…" });
  return blob;
}
