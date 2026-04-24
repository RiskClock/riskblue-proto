/**
 * Server-side DOCX generation for the analysis export.
 *
 * This is a Node port of `src/lib/analysisDocxExporter.ts`. It preserves
 * the same visible output:
 *  - one detection per page (page-break-before)
 *  - detection table (controls, drawing code, file name, area, dims, etc.)
 *  - cropped drawing image with a red circle highlight
 *  - proportional sizing constrained to ~620x720pt
 *  - filename pattern: `RiskBlue {Project_Name_With_Underscores} Assets and Systems Export {YYYYMMDD}.docx`
 *  - source-type-aware bucket routing
 *  - if bbox/circle cannot be resolved, falls back to the full page with a
 *    "highlight not resolved" caption
 *
 * Browser-only APIs are replaced as follows:
 *  - `document.createElement("canvas")` → `@napi-rs/canvas`
 *  - PDF rendering uses the legacy build of `pdfjs-dist` (Node-friendly)
 *
 * NOTE: This file is a scaffold of the worker side of the export. The
 * detection-rendering implementation should mirror `analysisDocxExporter.ts`
 * function-for-function. See README — when porting, copy the table layout,
 * image sizing constants, crop logic, and red-circle drawing math from
 * that file verbatim, replacing only the canvas + pdf.js calls.
 */

import { SupabaseClient } from "@supabase/supabase-js";
import { Document, Packer, Paragraph, HeadingLevel, PageBreak } from "docx";

interface GenerateArgs {
  supabase: SupabaseClient;
  summaryData: Record<string, unknown[]>;
  projectName: string;
  sourceType: string;
}

interface GenerateResult {
  buffer: Buffer;
  filename: string;
}

export async function generateExportDocx(
  args: GenerateArgs,
): Promise<GenerateResult> {
  const { summaryData, projectName } = args;

  // Build filename:  RiskBlue {Project_Name} Assets and Systems Export {YYYYMMDD}.docx
  const safeName = (projectName || "Project")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const now = new Date();
  const yyyymmdd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(
    2,
    "0",
  )}${String(now.getDate()).padStart(2, "0")}`;
  const filename = `RiskBlue ${safeName} Assets and Systems Export ${yyyymmdd}.docx`;

  // ------------------------------------------------------------------
  // SCAFFOLD: this minimal document is a placeholder so the worker can
  // round-trip a job end-to-end while you port the full renderer.
  //
  // To complete the port:
  //   1. Iterate `summaryData` (same shape as in `analysisDocxExporter.ts`).
  //   2. For each detection, build the table + image using the same
  //      logic as in the browser exporter.
  //   3. Use `@napi-rs/canvas` + `pdfjs-dist/legacy/build/pdf.mjs` to
  //      render and crop PDF pages, then draw the red circle at the
  //      cropped coordinates.
  //   4. Insert each detection with `pageBreakBefore: true`.
  // ------------------------------------------------------------------

  const detectionCount = Object.values(summaryData).reduce(
    (n, arr) => n + (Array.isArray(arr) ? arr.length : 0),
    0,
  );

  const children: Paragraph[] = [
    new Paragraph({
      text: `RiskBlue Assets and Systems Export`,
      heading: HeadingLevel.TITLE,
    }),
    new Paragraph({ text: projectName, heading: HeadingLevel.HEADING_1 }),
    new Paragraph({
      text: `Detections: ${detectionCount}`,
    }),
    new Paragraph({
      text: "(Full per-detection rendering is wired up in the worker's docx.ts — port the existing logic from src/lib/analysisDocxExporter.ts.)",
    }),
    new Paragraph({ children: [new PageBreak()] }),
  ];

  const doc = new Document({ sections: [{ children }] });
  const buffer = await Packer.toBuffer(doc);

  return { buffer, filename };
}
