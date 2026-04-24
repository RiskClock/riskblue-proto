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
  type: string;        // "Critical Asset" | "Water System" | "Process"
  className: string;   // AWP class name
  areaSqft: number;
  pipeDiameterMM?: number;
  controls: string[];
  fileName: string;
  drawingImage: { png: Uint8Array; width: number; height: number } | null;
  // True when the image was rendered but no bbox could be resolved, so no
  // red circle is drawn. Used to show a fallback caption under the image.
  drawingWithoutHighlight: boolean;
}

// ---------------------------------------------------------------------------
// Overlay helpers — TEMPORARY narrow-scope duplication of viewer logic.
// Names + behavior MUST stay identical to AnalysisSection.tsx so a future
// extraction into src/lib/overlayCandidates.ts is a mechanical move.
// Follow-up: extract these three helpers + the OverlayRow type into a shared
// module and import from both AnalysisSection.tsx and this file.
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
    .from(sourceTable as any)
    .select("default_control_ids")
    .eq("name", awpClassName)
    .maybeSingle();

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
// Drawing render — uses viewer-parity overlay resolution + red translucent
// circle that matches OverlayLayer (translucent fill, thin red outline,
// minimum diameter 34 CSS px scaled, side * 1.5 sizing).
// ---------------------------------------------------------------------------

const EXPORT_SCALE = 1.5;
// docx@9.6.1 ImageRun.transformation values are PIXELS (multiplied by 9525
// to produce EMU). Verified in node_modules/docx/dist/index.cjs.
const MAX_IMG_W_PX = 620; // ~6.5" at 96 DPI
const MAX_IMG_H_PX = 720; // ~7.5" at 96 DPI — leaves room for the table

// Cache PDF documents per storage_path within a single export run so we
// don't re-download the same file for every detection.
type PdfCache = Map<string, pdfjsLib.PDFDocumentProxy | null>;

async function loadPdf(
  storagePath: string,
  bucket: string,
  cache: PdfCache,
): Promise<pdfjsLib.PDFDocumentProxy | null> {
  if (cache.has(storagePath)) return cache.get(storagePath)!;
  try {
    const { data: fileData, error } = await supabase.storage.from(bucket).download(storagePath);
    if (error || !fileData) {
      cache.set(storagePath, null);
      return null;
    }
    const arrayBuffer = await fileData.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    cache.set(storagePath, pdf);
    return pdf;
  } catch (e) {
    console.warn("Failed to load PDF for export:", storagePath, e);
    cache.set(storagePath, null);
    return null;
  }
}

async function renderDrawingImage(
  storagePath: string | null,
  instance: SummarizedInstance,
  resultText: string | null,
  sourceType: string | undefined,
  pdfCache: PdfCache,
): Promise<{ png: Uint8Array; width: number; height: number; hasHighlight: boolean } | null> {
  if (!storagePath) return null;

  const bucket = sourceType === "manual_upload" ? "uploaded-drawings" : "drive-analysis-files";

  try {
    const pdf = await loadPdf(storagePath, bucket, pdfCache);
    if (!pdf) return null;

    // ---- Resolve overlay using the SAME priority as InstanceDetailModal ----
    const rows = resultText ? parseOverlayCandidates(resultText) : [];
    const matchingRow = findMatchingOverlayRow(rows, instance.id);
    const hintPage = matchingRow?.pageNum;
    const aiBBox = matchingRow?.aiBBox;
    const searchCandidates = buildOverlaySearchCandidates(matchingRow, instance);

    let pageNum = 1;
    let bbox: [number, number, number, number] | null = null;
    let coordSpace: "pixels" | "pdf-points" = "pixels";
    let aiViewportWidth = 0; // for pixels-coord rescaling
    // Whether we have any signal that this page is the right page for this
    // detection (matching overlay row OR successful text-layer match). If
    // false AND we have no bbox, we omit the image entirely rather than
    // showing an arbitrary first page.
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
      let textBBox = null as null | { x1: number; y1: number; x2: number; y2: number; pageNum: number };
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
        // Page is known from the overlay row even though we can't find the
        // exact bounds — render the page without a circle (fallback).
        pageNum = Math.min(hintPage, pdf.numPages);
        bbox = null;
        pageResolved = true;
      } else {
        // No bbox AND no page hint — don't render an arbitrary page.
        return null;
      }
    }

    // ---- Render the page ----
    const page = await pdf.getPage(pageNum);
    const exportViewport = page.getViewport({ scale: EXPORT_SCALE });

    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = exportViewport.width;
    sourceCanvas.height = exportViewport.height;
    const sourceCtx = sourceCanvas.getContext("2d")!;

    await page.render({ canvasContext: ctx_unused_placeholder(sourceCtx), viewport: exportViewport, canvas: sourceCanvas } as any).promise;

    // ---- Resolve circle geometry on the SOURCE canvas (full page) ----
    let circle: { cx: number; cy: number; diameter: number } | null = null;
    if (bbox) {
      const [x1, y1, x2, y2] = bbox;
      let cx: number, cy: number, side: number;
      if (coordSpace === "pixels") {
        // bbox is in scale-4 pixels; rescale to current canvas
        const k = exportViewport.width / aiViewportWidth;
        cx = ((x1 + x2) / 2) * k;
        cy = ((y1 + y2) / 2) * k;
        side = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) * k;
      } else {
        // pdf-points → viewport
        const [vx1, vy1, vx2, vy2] = exportViewport.convertToViewportRectangle([x1, y1, x2, y2]);
        cx = (vx1 + vx2) / 2;
        cy = (vy1 + vy2) / 2;
        side = Math.max(Math.abs(vx2 - vx1), Math.abs(vy2 - vy1));
      }
      const diameter = Math.max(34, side * 1.5);
      circle = { cx, cy, diameter };
    }

    // ---- Choose final canvas: cropped (if circle) or full page (fallback) ----
    let finalCanvas: HTMLCanvasElement;
    if (circle) {
      // Target crop aspect matches DOCX max area (620 x 720 → w/h ≈ 0.861).
      // Circle diameter should be ~20% of crop width (clamped 15–25%).
      const TARGET_DIAMETER_RATIO = 0.20;
      const MIN_DIAMETER_RATIO = 0.25; // → max crop = diameter / 0.25
      const MAX_DIAMETER_RATIO = 0.15; // → min crop = diameter / 0.15
      const TARGET_ASPECT_W_OVER_H = MAX_IMG_W_PX / MAX_IMG_H_PX; // ≈ 0.861

      let cropW = circle.diameter / TARGET_DIAMETER_RATIO;
      // Also enforce a minimum context margin of ~2.5x diameter on each side.
      // That implies cropW >= diameter + 2 * 2.5 * diameter = 6 * diameter.
      // 1 / 0.20 = 5 → bump to 6 when context margin dominates.
      cropW = Math.max(cropW, circle.diameter * 6);
      // Clamp ratio range so circle isn't too small or too large.
      const minCropFromMaxRatio = circle.diameter / MIN_DIAMETER_RATIO;
      const maxCropFromMinRatio = circle.diameter / MAX_DIAMETER_RATIO;
      cropW = Math.max(cropW, minCropFromMaxRatio);
      cropW = Math.min(cropW, maxCropFromMinRatio);

      let cropH = cropW / TARGET_ASPECT_W_OVER_H;

      // If crop is larger than the source page in either dim, fall back to full page.
      if (cropW >= sourceCanvas.width && cropH >= sourceCanvas.height) {
        finalCanvas = sourceCanvas;
        // Draw circle directly on the full page.
        const ctx = sourceCanvas.getContext("2d")!;
        drawHighlightCircle(ctx, circle.cx, circle.cy, circle.diameter);
      } else {
        // Clamp crop to source bounds while keeping aspect ratio when possible.
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
        // Draw circle in cropped-canvas coordinates.
        drawHighlightCircle(
          croppedCtx,
          circle.cx - cropX,
          circle.cy - cropY,
          circle.diameter,
        );
        finalCanvas = cropped;
      }
    } else {
      // No bbox/circle → full-page fallback (no highlight).
      finalCanvas = sourceCanvas;
    }

    const blob = await new Promise<Blob | null>((resolve) =>
      finalCanvas.toBlob((b) => resolve(b), "image/png", 0.85)
    );
    if (!blob) return null;
    const png = new Uint8Array(await blob.arrayBuffer());
    return { png, width: finalCanvas.width, height: finalCanvas.height, hasHighlight: bbox !== null };
  } catch (e) {
    console.warn("Failed to render drawing for export:", e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main Export Function
// ---------------------------------------------------------------------------
//
// Signature note: `onProgress` keeps its original 4th-arg position. `sourceType`
// is appended as the 5th arg so existing call sites (3 or 4 positional args)
// continue to work without changes.

export async function generateAnalysisDocx(
  requestId: string,
  summaryData: Record<string, SummarizedInstance[]>,
  projectName: string,
  onProgress?: (done: number, total: number) => void,
  sourceType?: string,
): Promise<Blob> {
  // 1. Gather all files for this request
  const { data: filesData } = await supabase
    .from("analysis_request_files")
    .select("id, name, storage_path")
    .eq("analysis_request_id", requestId);
  const files = filesData || [];

  // 2. Gather all analysis results for matching
  const { data: allResults } = await supabase
    .from("analysis_results")
    .select("file_id, awp_class_name, result_text, status")
    .eq("analysis_request_id", requestId)
    .eq("status", "complete");

  // 3. Collect AWP order data for prefix
  const [aData, wData, pData] = await Promise.all([
    supabase.from("critical_assets").select("name, id_prefix").eq("is_active", true),
    supabase.from("water_systems").select("name, id_prefix").eq("is_active", true),
    supabase.from("processes").select("name, id_prefix").eq("is_active", true),
  ]);
  const prefixMap: Record<string, string> = {};
  for (const x of [...(aData.data || []), ...(wData.data || []), ...(pData.data || [])]) {
    if (x.id_prefix) prefixMap[x.name] = x.id_prefix;
  }

  // 4. Flatten all instances and assign detection numbers
  const allInstances: Array<{
    awpClassName: string;
    instance: SummarizedInstance;
  }> = [];
  for (const [className, instances] of Object.entries(summaryData)) {
    for (const inst of instances) {
      allInstances.push({ awpClassName: className, instance: inst });
    }
  }

  const totalDetections = allInstances.length;
  if (totalDetections === 0) {
    throw new Error("No detection instances to export");
  }

  // 5. Build export rows
  const rows: InstanceExportRow[] = [];
  const categoryCache: Record<string, string> = {};
  const controlsCache: Record<string, string[]> = {};
  const pdfCache: PdfCache = new Map();

  for (let i = 0; i < allInstances.length; i++) {
    const { awpClassName, instance } = allInstances[i];
    onProgress?.(i, totalDetections);

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
    );

    const prefix = prefixMap[awpClassName] || awpClassName.replace(/[^a-zA-Z]/g, "").substring(0, 3).toUpperCase();
    const displayId = instance.id;

    rows.push({
      detectionNumber: i + 1,
      totalDetections,
      displayId,
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

  onProgress?.(totalDetections, totalDetections);

  // 6. Build DOCX
  const cellBorder = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
  const cellBorders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };
  const labelWidth = 2800;
  const valueWidth = 6560; // total = 9360 (US Letter with 1" margins)

  const buildInfoRow = (label: string, value: string) =>
    new DocxTableRow({
      cantSplit: true, // best-effort: keep a single row from breaking across pages
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

    // Hard guarantee: every detection after the first starts on a new page.
    if (idx > 0) {
      children.push(new Paragraph({ children: [new PageBreak()] }));
    }

    children.push(tableElement);

    if (row.drawingImage) {
      // Spacer with keepNext to push Word to keep the image with the table
      // when content fits (best-effort — Word may still overflow if too tall).
      children.push(
        new Paragraph({
          spacing: { before: 200 },
          keepNext: true,
        })
      );

      // Proportional sizing in PIXELS (docx@9.6.1 transformation unit).
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
        })
      );

      // Fallback caption: image was rendered without a red circle because we
      // couldn't resolve exact bounds. Make that explicit so the reader does
      // not assume the highlight succeeded.
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

  return Packer.toBlob(doc);
}
