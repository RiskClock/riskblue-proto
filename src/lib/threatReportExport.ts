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

import { supabase } from "@/integrations/supabase/client";
import { readableTextOn } from "@/lib/awpColor";
import riskblueLogoUrl from "@/assets/logo-riskblue.png";
import { resolveDocumentSource } from "@/components/viewer/hooks/useDocumentSource";
import { captureOverlayOnly } from "@/lib/overlayOnlyCapture";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// `readableTextOn` is re-exported so incidental callers keep resolving; it
// is not used directly in this module anymore.
void readableTextOn;

// Render a single PDF page to a PNG blob and composite the given overlays
// on top. Uses pdf.js directly (respects page /Rotate) and a lightweight
// offscreen OverlayLayer render for the overlay stamp. Never mounts the
// full DrawingViewer — that path is fragile across many sequential captures.
async function renderPageWithOverlays(
  pdfBlob: Blob,
  pageIdx: number,
  overlays: ThreatReportPageRef["overlays"],
  targetLongEdgePx: number,
): Promise<{ blob: Blob; width: number; height: number } | null> {
  try {
    const data = await pdfBlob.arrayBuffer();
    const doc = await pdfjsLib.getDocument({ data }).promise;
    if (pageIdx < 1 || pageIdx > doc.numPages) return null;
    const page = await doc.getPage(pageIdx);
    const base = page.getViewport({ scale: 1 });
    const scale = targetLongEdgePx / Math.max(base.width, base.height);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;

    if (overlays && overlays.length > 0) {
      const overlayInputs = overlays.map((o) => ({
        id: o.id,
        bbox: [o.nx, o.ny, o.nw ?? 0, o.nh ?? 0] as [number, number, number, number],
        coordSpace: "normalized" as const,
        color: o.color,
        label: o.label,
        shape: o.shape ?? ("circle" as const),
      }));
      const overlayCap = await captureOverlayOnly({
        pageSize: { width: canvas.width, height: canvas.height },
        overlays: overlayInputs,
        outScale: 1,
      });
      if (overlayCap) {
        const overlayImg = await createImageBitmap(overlayCap.blob);
        ctx.drawImage(overlayImg, 0, 0, canvas.width, canvas.height);
        overlayImg.close?.();
      }
    }

    const blob: Blob = await new Promise((res, rej) =>
      canvas.toBlob(
        (b) => (b ? res(b) : rej(new Error("Canvas encoding failed."))),
        "image/png",
        0.95,
      ),
    );
    return { blob, width: canvas.width, height: canvas.height };
  } catch (e) {
    console.warn("[threatReportExport] page render failed", e);
    return null;
  }
}



export interface ThreatReportPageRef {
  fileName: string;
  shortName: string;
  pageIdx: number;
  bucket: string;
  parentPath: string | null;
  /** File size in bytes; used as a cache-invalidation version token. */
  sizeBytes?: number | null;
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
    pipeDiameter?: string | null;
    pipeType?: string | null;
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
  overviewClasses: Array<{
    name: string;
    idPrefix: string;
    count: number;
    /** Optional per-attribute breakdown (e.g. by pipe size + type). */
    breakdown?: Array<{ attributes: Record<string, string>; count: number }>;
  }>;
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
      // Don't retry 4xx (other than 429) - likely auth/permission issue.
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
// Page rasterization is delegated to `capturePageToPng`, which mounts the
// real DrawingViewer offscreen and then reads back the placed DOM. This
// guarantees the exported PNG is pixel-for-pixel identical to what the user
// sees in the in-app Threat Report viewer (same PDF raster, same overlay
// positions, same label optimizer, same clamping). Previously this file
// re-implemented pdf.js rasterization and a hand-rolled overlay/label
// pipeline, which drifted from the viewer (anchor offsets, template-label
// offsets, and right/bottom-edge label clipping).


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

  // 2) Collect unique (page, overlay-set) pairs and rasterize. The cache key
  // must include a signature of the overlays because two spaces can point at
  // the same underlying PDF page (e.g. one physical sheet showing two levels)
  // but need different bbox/marker overlays rendered on top.
  const overlaySignature = (overlays: ThreatReportPageRef["overlays"]) => {
    // Small deterministic signature - stable across identical overlay sets.
    return overlays
      .map(
        (o) =>
          `${o.shape ?? "circle"}|${o.id}|${o.nx.toFixed(4)},${o.ny.toFixed(4)}|${(o.nw ?? 0).toFixed(4)}x${(o.nh ?? 0).toFixed(4)}|${o.color}|${o.label ?? ""}`,
      )
      .sort()
      .join("~");
  };
  const renderKeyFor = (pr: ThreatReportPageRef) =>
    `${pr.bucket}::${pr.parentPath}::${pr.pageIdx}::${overlaySignature(pr.overlays)}`;

  const pageRefs: ThreatReportPageRef[] = [];
  const pageRefIndex = new Map<string, number>();
  for (const space of payload.spaces) {
    for (const pr of space.pages) {
      if (!pr.parentPath) continue;
      const key = renderKeyFor(pr);
      if (pageRefIndex.has(key)) continue;
      pageRefIndex.set(key, pageRefs.length);
      pageRefs.push(pr);
    }
  }

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
    const key = renderKeyFor(pr);
    if (!pr.parentPath) {
      renderedByKey.set(key, null);
    } else {
      const rendered = await capturePageToPng({
        source: {
          kind: "supabase-storage",
          bucket: pr.bucket,
          path: pr.parentPath,
          mimeType: "application/pdf",
          version: pr.sizeBytes ?? undefined,
        },
        page: pr.pageIdx,
        overlays: pr.overlays,
        targetLongEdgePx: 1600,
      });
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

  // Project title: "{Project} Project" - omit "Project" suffix if the name
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
    ["Source Drawings", payload.sourceDrawings.join("; ") || "-"],
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
          ...payload.overviewClasses.flatMap((c) => {
            const mainRow = new TableRow({
              children: [
                tableBodyCell(c.idPrefix, 2000, { mono: true }),
                tableBodyCell(c.name, 5360),
                tableBodyCell(String(c.count), 2000),
              ],
            });
            const subRows = (c.breakdown ?? []).map((b) => {
              const label = Object.entries(b.attributes)
                .map(([k, v]) => `${k}: ${v}`)
                .join(" · ");
              return new TableRow({
                children: [
                  tableBodyCell("", 2000),
                  tableBodyCell(`    ↳ ${label}`, 5360, { muted: true }),
                  tableBodyCell(String(b.count), 2000),
                ],
              });
            });
            return [mainRow, ...subRows];
          }),
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
        para([text("No instances found in this space.", { italics: true, color: "6B7280" })]),
      );
    } else {
      const showUnit = sp.rows.some((r) => !!r.unitName);
      // Show attribute columns whenever any row in this space carries that
      // attribute — no class-name gating (mirrors the on-screen threat report).
      const showType = sp.rows.some((r) => !!(r.pipeType && r.pipeType.trim()));
      const showDiameter = sp.rows.some(
        (r) => !!(r.pipeDiameter && r.pipeDiameter.trim()),
      );

      // Fixed table width = 9360 twips (US Letter, 1" margins).
      // Base columns: Instance ID, Class, Annotation ID, Source.
      // Optional: Unit, Type, Pipe Diameter.
      type Col = [string, number];
      const cols: Col[] = [];
      cols.push(["Instance ID", 0]);
      cols.push(["Class", 0]);
      if (showUnit) cols.push(["Unit", 0]);
      if (showType) cols.push(["Type", 0]);
      cols.push(["Annotation ID", 0]);
      if (showDiameter) cols.push(["Pipe Diameter", 0]);
      cols.push(["Source", 0]);

      // Weight-based widths so the total always sums to 9360.
      const weightFor = (label: string): number => {
        switch (label) {
          case "Instance ID": return 26;
          case "Class": return 14;
          case "Unit": return 9;
          case "Type": return 11;
          case "Annotation ID": return 13;
          case "Pipe Diameter": return 12;
          case "Source": return 30;
          default: return 10;
        }
      };
      const totalW = 9360;
      const totalWeight = cols.reduce((s, [lbl]) => s + weightFor(lbl), 0);
      let assigned = 0;
      for (let i = 0; i < cols.length; i++) {
        if (i === cols.length - 1) {
          cols[i][1] = totalW - assigned;
        } else {
          const w = Math.round((weightFor(cols[i][0]) / totalWeight) * totalW);
          cols[i][1] = w;
          assigned += w;
        }
      }
      const widths = cols.map(([, w]) => w);

      const cellOptsFor = (
        label: string,
      ): { mono?: boolean; muted?: boolean } => {
        if (label === "Instance ID") return { mono: true };
        if (label === "Annotation ID") return { mono: true, muted: true };
        if (label === "Source") return { muted: true };
        return {};
      };
      const valueFor = (
        label: string,
        r: ThreatReportSpace["rows"][number],
      ): string => {
        switch (label) {
          case "Instance ID": return r.instanceId;
          case "Class": return r.awpClassName;
          case "Unit": return r.unitName ?? "-";
          case "Type": return (r.pipeType && r.pipeType.trim()) || "-";
          case "Pipe Diameter": return (r.pipeDiameter && r.pipeDiameter.trim()) || "-";
          case "Annotation ID": return r.annotationBaseId;
          case "Source": return `${r.fileName} · Page ${r.pageIndex}`;
          default: return "-";
        }
      };

      docChildren.push(
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: widths,
          rows: [
            new TableRow({
              tableHeader: true,
              children: cols.map(([lbl, w]) => tableHeaderCell(lbl, w)),
            }),
            ...sp.rows.map(
              (r) =>
                new TableRow({
                  children: cols.map(([lbl, w]) =>
                    tableBodyCell(valueFor(lbl, r), w, cellOptsFor(lbl)),
                  ),
                }),
            ),
          ],
        }),
      );
    }

    if (sp.units.length > 0) {
      const totalUnits = sp.units.reduce((acc, u) => acc + Math.max(1, u.count ?? 1), 0);
      docChildren.push(
        para(
          [
            text(
              `Units on this level (${totalUnits} ${totalUnits === 1 ? "unit" : "units"})`,
              { bold: true, size: 20 },
            ),
          ],
          { spacing: { before: 240, after: 120 } },
        ),
      );
      for (const u of sp.units) {
        const cleaned = u.name.replace(/^Template\s*-\s*/, "");
        const pages = u.pageIdxs.map((p) => `p${p}`).join(", ");
        const count = u.count ?? 1;
        const mult = count > 1 ? ` x${count}` : "";
        docChildren.push(
          para([text(`${cleaned} (${pages})${mult}`)]),
        );
      }
    }

    // Drawings for this space.
    for (const pr of sp.pages) {
      const key = renderKeyFor(pr);
      const rendered = renderedByKey.get(key);
      docChildren.push(
        para(
          [
            text(`${pr.tabLabel}`, { bold: true, size: 20 }),
            text(`  -  ${pr.fileName} · Page ${pr.pageIdx}`, { size: 18, color: "6B7280" }),
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
    title: `Threat Report - ${payload.projectName}`,
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
