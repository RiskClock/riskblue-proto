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
  drawingImage: Uint8Array | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Determine category from source tables */
async function resolveCategory(awpClassName: string): Promise<string> {
  const { data: a } = await supabase.from("critical_assets").select("name").eq("name", awpClassName).maybeSingle();
  if (a) return "Critical Asset";
  const { data: w } = await supabase.from("water_systems").select("name").eq("name", awpClassName).maybeSingle();
  if (w) return "Water System";
  const { data: p } = await supabase.from("processes").select("name").eq("name", awpClassName).maybeSingle();
  if (p) return "Process";
  return "Asset";
}

/** Fetch default control names for an AWP class */
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

/** Find the source file name for an instance by matching its ID in analysis results */
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

  // Fallback: first file
  if (files.length > 0) {
    return { fileName: files[0].name, storagePath: files[0].storage_path };
  }
  return { fileName: "Unknown", storagePath: null };
}

/** Render a PDF page from storage, draw red circle on bbox, return PNG bytes */
async function renderDrawingImage(
  storagePath: string | null,
  instanceId: string,
  awpClassName: string,
  requestId: string,
  resultText: string | null,
): Promise<Uint8Array | null> {
  if (!storagePath) return null;

  try {
    // Download the PDF from storage
    const { data: fileData, error } = await supabase.storage
      .from("drive-analysis-files")
      .download(storagePath);
    if (error || !fileData) return null;

    const arrayBuffer = await fileData.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    // Find the page — try to extract page number from result_text
    let pageNum = 1;
    if (resultText) {
      const lines = resultText.split("\n").filter((l) => l.includes("|"));
      for (const line of lines) {
        if (line.includes(instanceId)) {
          const pageMatch = line.match(/\|\s*(\d+)\s*\|/);
          if (pageMatch) {
            const parsed = parseInt(pageMatch[1], 10);
            if (parsed > 0 && parsed <= pdf.numPages) pageNum = parsed;
          }
          break;
        }
      }
    }

    const page = await pdf.getPage(pageNum);
    const scale = 1.5;
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;

    await page.render({ canvasContext: ctx, viewport }).promise;

    // Try to find bbox from result_text
    if (resultText) {
      const lines = resultText.split("\n").filter((l) => l.includes("|"));
      for (const line of lines) {
        if (line.includes(instanceId)) {
          const bboxMatch = line.match(
            /\(?\s*(\d+)[,\s]+(\d+)\s*\)?\s*(?:→|->|—|–|-)\s*\(?\s*(\d+)[,\s]+(\d+)\s*\)?/
          );
          if (bboxMatch) {
            const x1 = parseInt(bboxMatch[1], 10) * scale;
            const y1 = parseInt(bboxMatch[2], 10) * scale;
            const x2 = parseInt(bboxMatch[3], 10) * scale;
            const y2 = parseInt(bboxMatch[4], 10) * scale;
            const cx = (x1 + x2) / 2;
            const cy = (y1 + y2) / 2;
            const r = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) / 2 + 15;

            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, 2 * Math.PI);
            ctx.strokeStyle = "red";
            ctx.lineWidth = 4;
            ctx.stroke();
          }
          break;
        }
      }
    }

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/png", 0.85)
    );
    if (!blob) return null;
    return new Uint8Array(await blob.arrayBuffer());
  } catch (e) {
    console.warn("Failed to render drawing for export:", e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main Export Function
// ---------------------------------------------------------------------------

export async function generateAnalysisDocx(
  requestId: string,
  summaryData: Record<string, SummarizedInstance[]>,
  projectName: string,
  onProgress?: (done: number, total: number) => void,
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

  for (let i = 0; i < allInstances.length; i++) {
    const { awpClassName, instance } = allInstances[i];
    onProgress?.(i, totalDetections);

    // Category
    if (!categoryCache[awpClassName]) {
      categoryCache[awpClassName] = await resolveCategory(awpClassName);
    }
    const type = categoryCache[awpClassName];

    // Controls
    if (!controlsCache[awpClassName]) {
      controlsCache[awpClassName] = await fetchControlNames(awpClassName, type);
    }
    const controls = controlsCache[awpClassName];

    // Source file
    const sourceFile = await findSourceFile(requestId, awpClassName, instance.id, files);

    // Find result_text for this instance
    let resultText: string | null = null;
    if (allResults) {
      for (const r of allResults) {
        if (r.awp_class_name === awpClassName && r.result_text?.includes(instance.id)) {
          resultText = r.result_text;
          break;
        }
      }
    }

    // Render drawing image
    const drawingImage = await renderDrawingImage(
      sourceFile.storagePath,
      instance.id,
      awpClassName,
      requestId,
      resultText,
    );

    // Build display ID
    const prefix = prefixMap[awpClassName] || awpClassName.replace(/[^a-zA-Z]/g, "").substring(0, 3).toUpperCase();
    // Use the instance.id as-is (it's already something like "SWC-901")
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
      drawingImage,
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

    // Page break before all except first
    if (idx > 0) {
      children.push(new Paragraph({ children: [new PageBreak()] }));
    }

    children.push(tableElement);

    // Add drawing image if available
    if (row.drawingImage) {
      children.push(new Paragraph({ spacing: { before: 200 } }));

      // Scale image to fit page width (9360 DXA = ~6.5 inches = ~468pt)
      // Keep aspect ratio — cap at ~468px wide and ~600px tall
      const maxWidth = 468;
      const maxHeight = 550;

      // We don't know actual dimensions from PNG bytes, so use maxWidth and let aspect ratio be approximate
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new ImageRun({
              type: "png",
              data: row.drawingImage,
              transformation: { width: maxWidth, height: maxHeight },
              altText: {
                title: `Drawing for ${row.displayId}`,
                description: `Source drawing showing ${row.displayName} detection`,
                name: `drawing-${row.displayId}`,
              },
            }),
          ],
        })
      );
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
