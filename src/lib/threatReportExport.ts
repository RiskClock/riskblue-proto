// Threat Report → DOCX export pipeline.
// Runs entirely client-side, then hands off to an edge function for email delivery.
//
// Flow:
//   1. Insert a `report_exports` row (status=pending) so we have an id + audit trail.
//   2. Rasterize each unique (parent PDF, page) referenced by the report and draw
//      the same colored ID markers used by the in-app DrawingPageBlock.
//   3. Assemble a DOCX (cover, TOC-like list, Overview, Summary, per-space sections).
//   4. Upload the DOCX to `project-reports/{projectId}/threat-reports/{exportId}/threat-report.docx`.
//   5. Update the row → status='ready' with storage_path / file_size / page_count.
//   6. Invoke `send-threat-report-email` to email the requester a link to the
//      frontend route `/projects/:projectId/export/:exportId`.
//
// The email link routes through the frontend so the user must be signed-in and a
// project member; the frontend then calls `download-threat-report` to mint a
// fresh 5-minute signed URL.

import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { supabase } from "@/integrations/supabase/client";
import riskblueLogoUrl from "@/assets/logo-riskblue.png";

if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
}


export interface ThreatReportPageRef {
  fileName: string;
  shortName: string;
  pageIdx: number;
  bucket: string;
  parentPath: string | null;
  overlays: Array<{
    id: string;
    nx: number;
    ny: number;
    color: string;
    label: string;
    /** Defaults to "circle" when omitted. */
    shape?: "circle" | "rect";
    /** Rect width/height in normalized 0..1 of the page (rect shape only). */
    nw?: number;
    nh?: number;
  }>;
  tabLabel: string;
}

export interface ThreatReportSpace {
  name: string; // "Level 2" or "__unassigned__"
  rows: Array<{
    instanceId: string;
    awpClassName: string;
    unitName: string | null;
    annotationBaseId: string;
    fileName: string;
    pageIndex: number;
  }>;
  units: Array<{ name: string; pageIdxs: number[]; count?: number }>;
  pages: ThreatReportPageRef[];
}

export interface ThreatReportPayload {
  projectId: string;
  analysisRequestId: string | null;
  projectName: string;
  reportDate: string;
  sourceDrawings: string[];
  overviewClasses: Array<{ name: string; idPrefix: string; count: number }>;
  summary: {
    spaces: string[]; // includes "__unassigned__" possibly
    classes: Array<{ name: string; idPrefix: string }>;
    matrix: Record<string, Record<string, number>>;
  };
  spaces: ThreatReportSpace[];
}

export interface ExportProgress {
  phase: "init" | "rendering" | "assembling" | "uploading" | "notifying" | "done";
  message: string;
  current?: number;
  total?: number;
}

type ProgressCb = (p: ExportProgress) => void;

const STORAGE_BUCKET = "project-reports";

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function sleep(ms: number) {
  return new Promise<void>((res) => setTimeout(res, ms));
}

async function uploadWithRetry(
  path: string,
  blob: Blob,
  contentType: string,
  attempts = 3,
): Promise<void> {
  let lastErr: unknown = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const { error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(path, blob, { contentType, upsert: true });
      if (!error) return;
      lastErr = error;
      // Don't retry 4xx (other than 429) — likely auth/permission issue.
      const status = (error as any)?.statusCode || (error as any)?.status;
      if (status && status >= 400 && status < 500 && status !== 429) break;
    } catch (e) {
      lastErr = e;
    }
    if (i < attempts - 1) await sleep(250 * Math.pow(3, i));
  }
  throw lastErr ?? new Error(`Upload failed: ${path}`);
}

// ---------------------------------------------------------------------------
// PDF rasterization with markers
// ---------------------------------------------------------------------------

type PdfCache = Map<string, pdfjsLib.PDFDocumentProxy | null>;

async function loadPdf(
  bucket: string,
  storagePath: string,
  cache: PdfCache,
): Promise<pdfjsLib.PDFDocumentProxy | null> {
  const key = `${bucket}:${storagePath}`;
  if (cache.has(key)) return cache.get(key)!;
  try {
    const { data: file, error } = await supabase.storage.from(bucket).download(storagePath);
    if (error || !file) {
      cache.set(key, null);
      return null;
    }
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    cache.set(key, pdf);
    return pdf;
  } catch (e) {
    console.warn("[threatReportExport] PDF load failed", storagePath, e);
    cache.set(key, null);
    return null;
  }
}

async function renderPageWithMarkers(
  pdf: pdfjsLib.PDFDocumentProxy,
  pageIdx: number,
  overlays: ThreatReportPageRef["overlays"],
): Promise<{ blob: Blob; width: number; height: number } | null> {
  const pageNum = Math.max(1, Math.min(pageIdx, pdf.numPages));
  const page = await pdf.getPage(pageNum);
  // Target ~1600px on the long edge for decent DOCX print quality.
  const baseVp = page.getViewport({ scale: 1 });
  const targetLong = 1600;
  const scale = Math.min(3, targetLong / Math.max(baseVp.width, baseVp.height));
  const vp = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  // White bg in case the PDF page has transparency.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;

  // Draw rect overlays first (level/unit floor plan bboxes) so circles render on top.
  for (const o of overlays) {
    if (o.shape !== "rect") continue;
    const x = Math.round(o.nx * canvas.width);
    const y = Math.round(o.ny * canvas.height);
    const w = Math.max(2, Math.round((o.nw ?? 0) * canvas.width));
    const h = Math.max(2, Math.round((o.nh ?? 0) * canvas.height));
    // Translucent outline rect
    ctx.lineWidth = Math.max(2, Math.round(canvas.width * 0.0015));
    ctx.strokeStyle = o.color;
    ctx.strokeRect(x, y, w, h);
    // Label pill anchored at top-left, outside the rect.
    const text = o.label;
    const labelH = Math.max(16, Math.round(canvas.width * 0.014));
    ctx.font = `bold ${Math.round(labelH * 0.7)}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    const padX = Math.round(labelH * 0.35);
    const tw = Math.ceil(ctx.measureText(text).width) + padX * 2;
    const lx = Math.max(2, x);
    const ly = Math.max(2, y - labelH - 2);
    ctx.fillStyle = o.color;
    roundRect(ctx, lx, ly, tw, labelH, 3);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(text, lx + padX, ly + labelH / 2 + 1);
  }

  // Draw circle annotation overlays.
  const labelFont = `bold ${Math.max(11, Math.round(canvas.width * 0.011))}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.font = labelFont;
  const radius = Math.max(7, Math.round(canvas.width * 0.008));

  for (const o of overlays) {
    if (o.shape === "rect") continue;
    const cx = Math.round(o.nx * canvas.width);
    const cy = Math.round(o.ny * canvas.height);
    // Translucent fill
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = withAlpha(o.color, 0.35);
    ctx.fill();
    // White halo
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 1, 0, Math.PI * 2);
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.stroke();
    // Colored ring
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = o.color;
    ctx.stroke();

    // Label bubble offset down-right from marker.
    ctx.font = labelFont;
    const text = o.label;
    const metrics = ctx.measureText(text);
    const padX = 6;
    const padY = 3;
    const w = Math.ceil(metrics.width) + padX * 2;
    const h = Math.ceil(parseInt(labelFont, 10)) + padY * 2;
    const lx = Math.min(canvas.width - w - 2, cx + radius + 4);
    const ly = Math.min(canvas.height - h - 2, cy + radius + 4);
    // bubble
    ctx.fillStyle = o.color;
    roundRect(ctx, lx, ly, w, h, 4);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(text, lx + padX, ly + h / 2 + 1);
  }

  const blob: Blob | null = await new Promise((res) =>
    canvas.toBlob((b) => res(b), "image/png", 0.92),
  );
  if (!blob) return null;
  return { blob, width: canvas.width, height: canvas.height };
}

function withAlpha(hexOrRgb: string, alpha: number): string {
  // Accept #rrggbb, rgb(...), or rgba(...).
  if (hexOrRgb.startsWith("#") && hexOrRgb.length === 7) {
    const r = parseInt(hexOrRgb.slice(1, 3), 16);
    const g = parseInt(hexOrRgb.slice(3, 5), 16);
    const b = parseInt(hexOrRgb.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  if (hexOrRgb.startsWith("rgb(")) {
    return hexOrRgb.replace("rgb(", "rgba(").replace(")", `,${alpha})`);
  }
  return hexOrRgb;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export async function runThreatReportExport(
  payload: ThreatReportPayload,
  onProgress: ProgressCb,
): Promise<{ exportId: string }> {
  onProgress({ phase: "init", message: "Preparing report..." });

  // 1) Insert pending row.
  const { data: userResp } = await supabase.auth.getUser();
  const userId = userResp?.user?.id;
  if (!userId) throw new Error("You must be signed in to export reports.");

  const { data: inserted, error: insertErr } = await supabase
    .from("report_exports" as any)
    .insert({
      project_id: payload.projectId,
      analysis_request_id: payload.analysisRequestId,
      user_id: userId,
      status: "processing",
    })
    .select("id")
    .single();
  if (insertErr || !inserted) {
    throw new Error(`Could not create export job: ${(insertErr as any)?.message ?? "unknown"}`);
  }
  const exportId = (inserted as any).id as string;
  const folder = `${payload.projectId}/threat-reports/${exportId}`;

  // 2) Collect unique pages and rasterize.
  const pageRefs: ThreatReportPageRef[] = [];
  const pageRefIndex = new Map<string, number>();
  for (const space of payload.spaces) {
    for (const pr of space.pages) {
      if (!pr.parentPath) continue;
      const key = `${pr.bucket}::${pr.parentPath}::${pr.pageIdx}`;
      if (pageRefIndex.has(key)) continue;
      pageRefIndex.set(key, pageRefs.length);
      pageRefs.push(pr);
    }
  }

  const pdfCache: PdfCache = new Map();
  const renderedByKey = new Map<
    string,
    { png: ArrayBuffer; width: number; height: number } | null
  >();
  let done = 0;
  for (const pr of pageRefs) {
    onProgress({
      phase: "rendering",
      message: `Preparing item ${done + 1} of ${pageRefs.length}...`,
      current: done,
      total: pageRefs.length,
    });
    const pdf = await loadPdf(pr.bucket, pr.parentPath!, pdfCache);
    const key = `${pr.bucket}::${pr.parentPath}::${pr.pageIdx}`;
    if (!pdf) {
      renderedByKey.set(key, null);
    } else {
      const rendered = await renderPageWithMarkers(pdf, pr.pageIdx, pr.overlays);
      if (rendered) {
        renderedByKey.set(key, {
          png: await rendered.blob.arrayBuffer(),
          width: rendered.width,
          height: rendered.height,
        });
      } else {
        renderedByKey.set(key, null);
      }
    }
    done += 1;
    // Yield to keep UI responsive.
    await sleep(0);
  }

  // Drop pdf.js handles.
  for (const pdf of pdfCache.values()) {
    try {
      pdf?.cleanup?.();
      pdf?.destroy?.();
    } catch {
      // ignore
    }
  }

  // 3) Build DOCX.
  onProgress({ phase: "assembling", message: "Assembling report document..." });

  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    AlignmentType,
    Table,
    TableRow,
    TableCell,
    WidthType,
    BorderStyle,
    ShadingType,
    ImageRun,
    PageBreak,
    LevelFormat,
  } = await import("docx");

  const HEAD_FILL = "0F4C81";
  const HEAD_TEXT = "FFFFFF";
  const BAND_FILL = "EEF2F6";
  const BORDER = { style: BorderStyle.SINGLE, size: 4, color: "C9D1D9" };
  const cellBorders = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };

  const text = (s: string, opts?: any) => new TextRun({ text: s, ...(opts || {}) });
  const para = (children: any[], opts?: any) => new Paragraph({ children, ...(opts || {}) });

  function tableHeaderCell(label: string, width: number) {
    return new TableCell({
      borders: cellBorders,
      width: { size: width, type: WidthType.DXA },
      shading: { fill: HEAD_FILL, type: ShadingType.CLEAR, color: "auto" },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [
        new Paragraph({
          children: [new TextRun({ text: label, bold: true, color: HEAD_TEXT, size: 18 })],
        }),
      ],
    });
  }
  function tableBodyCell(label: string, width: number, opts?: { mono?: boolean; muted?: boolean }) {
    return new TableCell({
      borders: cellBorders,
      width: { size: width, type: WidthType.DXA },
      margins: { top: 60, bottom: 60, left: 120, right: 120 },
      children: [
        new Paragraph({
          children: [
            new TextRun({
              text: label,
              size: 18,
              font: opts?.mono ? "Consolas" : undefined,
              color: opts?.muted ? "6B7280" : undefined,
            }),
          ],
        }),
      ],
    });
  }

  const docChildren: any[] = [];

  // ── Cover page ─────────────────────────────────────────────────────────
  // Fetch the RiskBlue logo as PNG bytes for ImageRun.
  let logoBytes: ArrayBuffer | null = null;
  try {
    const res = await fetch(riskblueLogoUrl);
    if (res.ok) logoBytes = await res.arrayBuffer();
  } catch {
    logoBytes = null;
  }

  // Project title: "{Project} Project" — omit "Project" suffix if the name
  // already ends with the word "project" (case-insensitive).
  const trimmedName = (payload.projectName || "").trim();
  const endsWithProject = /\bproject\s*$/i.test(trimmedName);
  const projectTitleLine = endsWithProject ? trimmedName : `${trimmedName} Project`;
  // Exported date: "MMM dd, yyyy"
  const coverDate = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });

  docChildren.push(
    para([], { spacing: { before: 3000 } }),
  );
  if (logoBytes) {
    // Logo is 1487x439 (~3.39:1). Render at ~240x71 px on cover.
    docChildren.push(
      para(
        [
          new ImageRun({
            type: "png",
            data: logoBytes,
            transformation: { width: 240, height: 71 },
            altText: {
              title: "RiskBlue",
              description: "RiskBlue logo",
              name: "riskblue-logo",
            },
          }),
        ],
        { alignment: AlignmentType.CENTER, spacing: { after: 400 } },
      ),
    );
  }
  docChildren.push(
    para([text("RiskBlue Drawing Analysis", { bold: true, size: 48, color: HEAD_FILL })], {
      alignment: AlignmentType.CENTER,
      spacing: { before: 200 },
    }),
    para([text(projectTitleLine, { bold: true, size: 40 })], {
      alignment: AlignmentType.CENTER,
      spacing: { before: 160 },
    }),
    para([text("Workbench Drawing Analysis Report", { size: 24, color: "374151" })], {
      alignment: AlignmentType.CENTER,
      spacing: { before: 400 },
    }),
    para(
      [
        text(`Prepared by RiskBlue | ${coverDate} | Version 1`, {
          size: 20,
          color: "6B7280",
        }),
      ],
      { alignment: AlignmentType.CENTER, spacing: { before: 200 } },
    ),
    para([new PageBreak()]),
  );


  // ── Table of contents ──────────────────────────────────────────────────
  docChildren.push(
    para([text("Table of Contents", { bold: true, size: 32, color: HEAD_FILL })], {
      heading: HeadingLevel.HEADING_1,
    }),
    para([text("Overview")], { numbering: { reference: "toc", level: 0 } }),
    para([text("Summary")], { numbering: { reference: "toc", level: 0 } }),
  );
  for (const sp of payload.spaces) {
    const label = sp.name === "__unassigned__" ? "Unassigned" : sp.name;
    docChildren.push(para([text(label)], { numbering: { reference: "toc", level: 0 } }));
  }
  docChildren.push(para([new PageBreak()]));

  // ── Overview ───────────────────────────────────────────────────────────
  docChildren.push(
    para([text("Report Overview", { bold: true, size: 32, color: HEAD_FILL })], {
      heading: HeadingLevel.HEADING_1,
    }),
    para(
      [
        text(
          `RiskBlue reviewed the referenced drawing sheets to identify assets and water systems at risk across spaces for the ${payload.projectName} project. The report summarizes detected items and provides space-by-space occurrence tables paired with the corresponding drawing views.`,
        ),
      ],
      { spacing: { after: 200 } },
    ),
  );

  const meta: Array<[string, string]> = [
    ["Project", payload.projectName],
    ["Report Type", "Workbench Drawing Analysis"],
    ["Prepared By", "RiskBlue"],
    ["Report Date", payload.reportDate],
    ["Document Version", "V1"],
    ["Source Drawings", payload.sourceDrawings.join("; ") || "—"],
  ];
  docChildren.push(
    new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [2400, 6960],
      rows: meta.map(
        ([k, v]) =>
          new TableRow({
            children: [
              new TableCell({
                borders: cellBorders,
                width: { size: 2400, type: WidthType.DXA },
                shading: { fill: BAND_FILL, type: ShadingType.CLEAR, color: "auto" },
                margins: { top: 60, bottom: 60, left: 120, right: 120 },
                children: [para([text(k, { bold: true, size: 18 })])],
              }),
              tableBodyCell(v, 6960),
            ],
          }),
      ),
    }),
    para([], { spacing: { before: 300 } }),
    para([text("Assets at Risk Detections", { bold: true, size: 24 })], {
      spacing: { before: 200, after: 100 },
    }),
  );

  if (payload.overviewClasses.length > 0) {
    docChildren.push(
      new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [2000, 5360, 2000],
        rows: [
          new TableRow({
            tableHeader: true,
            children: [
              tableHeaderCell("Prefix", 2000),
              tableHeaderCell("Class", 5360),
              tableHeaderCell("Count", 2000),
            ],
          }),
          ...payload.overviewClasses.map(
            (c) =>
              new TableRow({
                children: [
                  tableBodyCell(c.idPrefix, 2000, { mono: true }),
                  tableBodyCell(c.name, 5360),
                  tableBodyCell(String(c.count), 2000),
                ],
              }),
          ),
        ],
      }),
    );
  } else {
    docChildren.push(para([text("No detections yet.", { italics: true, color: "6B7280" })]));
  }
  docChildren.push(para([new PageBreak()]));

  // ── Summary matrix ────────────────────────────────────────────────────
  docChildren.push(
    para([text("Summary", { bold: true, size: 32, color: HEAD_FILL })], {
      heading: HeadingLevel.HEADING_1,
    }),
    para([text("Counts per space by class.", { italics: true, color: "6B7280" })], {
      spacing: { after: 200 },
    }),
  );
  {
    const cols = payload.summary.classes;
    const tableW = 9360;
    const labelW = Math.max(1600, Math.min(2600, Math.round(tableW * 0.25)));
    const remaining = tableW - labelW;
    const colW = cols.length > 0 ? Math.floor(remaining / cols.length) : remaining;
    const widths = [labelW, ...cols.map(() => colW)];
    docChildren.push(
      new Table({
        width: { size: tableW, type: WidthType.DXA },
        columnWidths: widths,
        rows: [
          new TableRow({
            tableHeader: true,
            children: [
              tableHeaderCell("Space", labelW),
              ...cols.map((c) => tableHeaderCell(c.idPrefix || c.name, colW)),
            ],
          }),
          ...payload.summary.spaces.map((sp) => {
            const label = sp === "__unassigned__" ? "Unassigned" : sp;
            const inner = payload.summary.matrix[sp] || {};
            return new TableRow({
              children: [
                tableBodyCell(label, labelW),
                ...cols.map((c) => tableBodyCell(String(inner[c.name] || 0), colW)),
              ],
            });
          }),
        ],
      }),
    );
  }
  docChildren.push(para([new PageBreak()]));

  // ── Per-space sections ────────────────────────────────────────────────
  for (let si = 0; si < payload.spaces.length; si++) {
    const sp = payload.spaces[si];
    const label = sp.name === "__unassigned__" ? "Unassigned" : sp.name;
    docChildren.push(
      para([text(label, { bold: true, size: 28, color: HEAD_FILL })], {
        heading: HeadingLevel.HEADING_1,
      }),
    );

    if (sp.rows.length === 0) {
      docChildren.push(
        para([text("No objects found in this space.", { italics: true, color: "6B7280" })]),
      );
    } else {
      const showUnit = sp.rows.some((r) => !!r.unitName);
      const cols = showUnit
        ? [
            ["Instance ID", 1500],
            ["Class", 2400],
            ["Unit", 1500],
            ["Annotation ID", 1700],
            ["Source", 2260],
          ]
        : [
            ["Instance ID", 1700],
            ["Class", 2800],
            ["Annotation ID", 2000],
            ["Source", 2860],
          ];
      const widths = cols.map(([, w]) => w as number);
      docChildren.push(
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: widths,
          rows: [
            new TableRow({
              tableHeader: true,
              children: cols.map(([lbl, w]) => tableHeaderCell(lbl as string, w as number)),
            }),
            ...sp.rows.map((r) => {
              const cells = showUnit
                ? [
                    tableBodyCell(r.instanceId, 1500, { mono: true }),
                    tableBodyCell(r.awpClassName, 2400),
                    tableBodyCell(r.unitName ?? "—", 1500),
                    tableBodyCell(r.annotationBaseId, 1700, { mono: true, muted: true }),
                    tableBodyCell(`${r.fileName} · Page ${r.pageIndex}`, 2260, { muted: true }),
                  ]
                : [
                    tableBodyCell(r.instanceId, 1700, { mono: true }),
                    tableBodyCell(r.awpClassName, 2800),
                    tableBodyCell(r.annotationBaseId, 2000, { mono: true, muted: true }),
                    tableBodyCell(`${r.fileName} · Page ${r.pageIndex}`, 2860, { muted: true }),
                  ];
              return new TableRow({ children: cells });
            }),
          ],
        }),
      );
    }

    if (sp.units.length > 0) {
      docChildren.push(
        para([text(`Units on this level (${sp.units.length})`, { bold: true, size: 20 })], {
          spacing: { before: 240, after: 120 },
        }),
      );
      for (const u of sp.units) {
        const cleaned = u.name.replace(/^Template\s*-\s*/, "");
        docChildren.push(
          para([
            text(cleaned),
            text(`  ·  ${u.pageIdxs.map((p) => `p${p}`).join(", ")}`, { color: "6B7280" }),
          ]),
        );
      }
    }

    // Drawings for this space.
    for (const pr of sp.pages) {
      const key = `${pr.bucket}::${pr.parentPath}::${pr.pageIdx}`;
      const rendered = renderedByKey.get(key);
      docChildren.push(
        para(
          [
            text(`${pr.tabLabel}`, { bold: true, size: 20 }),
            text(`  —  ${pr.fileName} · Page ${pr.pageIdx}`, { size: 18, color: "6B7280" }),
          ],
          { spacing: { before: 240, after: 80 } },
        ),
      );
      if (rendered) {
        // Fit to content width 9360 DXA ≈ 6.5". Image transformation uses px.
        const maxPx = 600;
        const aspect = rendered.width / rendered.height;
        let w = maxPx;
        let h = Math.round(maxPx / aspect);
        if (h > 750) {
          h = 750;
          w = Math.round(h * aspect);
        }
        docChildren.push(
          para([
            new ImageRun({
              type: "png",
              data: rendered.png,
              transformation: { width: w, height: h },
              altText: {
                title: pr.tabLabel,
                description: `${pr.fileName} page ${pr.pageIdx}`,
                name: `${pr.fileName}-p${pr.pageIdx}`,
              },
            }),
          ]),
        );
      } else {
        docChildren.push(
          para([text("Drawing unavailable.", { italics: true, color: "9CA3AF" })]),
        );
      }
    }

    if (si < payload.spaces.length - 1) {
      docChildren.push(para([new PageBreak()]));
    }
  }

  const doc = new Document({
    creator: "RiskBlue",
    title: `Threat Report — ${payload.projectName}`,
    styles: {
      default: { document: { run: { font: "Calibri", size: 22 } } },
    },
    numbering: {
      config: [
        {
          reference: "toc",
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: "%1.",
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
          },
        },
        children: docChildren,
      },
    ],
  });

  // 4) Upload final DOCX.
  onProgress({ phase: "uploading", message: "Uploading report..." });
  const docBlob = await Packer.toBlob(doc);
  const docPath = `${folder}/threat-report.docx`;
  await uploadWithRetry(
    docPath,
    docBlob,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );

  // 5) Mark row ready.
  await supabase
    .from("report_exports" as any)
    .update({
      status: "ready",
      storage_path: docPath,
      file_size: docBlob.size,
      page_count: pageRefs.length,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    })
    .eq("id", exportId);

  // 6) Notify by email (best-effort, doesn't block success).
  onProgress({ phase: "notifying", message: "Sending notification..." });
  try {
    await supabase.functions.invoke("send-threat-report-email", {
      body: { exportId },
    });
  } catch (e) {
    console.warn("[threatReportExport] email notification failed", e);
  }

  onProgress({ phase: "done", message: "Done." });
  return { exportId };
}
