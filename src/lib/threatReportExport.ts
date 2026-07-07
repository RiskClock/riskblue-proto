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
import { readableTextOn } from "@/lib/awpColor";
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

  // Draw circle annotation overlays with collision-aware label placement.
  // Ports the OverlayLayer optimizer (candidate ring sweep, leader-line
  // penalties, hard filter) into canvas space so DOCX drawings never stack
  // labels on top of other markers or their leader lines.
  const circleOverlays = overlays.filter((o) => o.shape !== "rect");
  if (circleOverlays.length > 0) {
    const labelSize = Math.max(11, Math.round(canvas.width * 0.011));
    const labelFont = `bold ${labelSize}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx.font = labelFont;
    const radius = Math.max(9, Math.round(canvas.width * 0.0104));
    const padX = 6;
    const padY = 3;
    const lineH = labelSize + 2; // per-line height
    const gap = 2;

    type Circle = {
      id: string;
      cx: number;
      cy: number;
      r: number;
      color: string;
      label: string;
      lines: string[];
    };
    const circles: Circle[] = circleOverlays.map((o) => {
      const raw = o.label ?? "";
      const lines = raw ? raw.split("\n") : [];
      return {
        id: o.id,
        cx: Math.round(o.nx * canvas.width),
        cy: Math.round(o.ny * canvas.height),
        r: radius,
        color: o.color,
        label: raw,
        lines,
      };
    });

    type Cand = { x: number; y: number; w: number; h: number; ax: number; ay: number; leader: number };
    const widths = circles.map((c) => {
      if (c.lines.length === 0) return padX * 2;
      const maxW = Math.max(...c.lines.map((ln) => Math.ceil(ctx.measureText(ln).width)));
      return maxW + padX * 2;
    });
    const heights = circles.map((c) => {
      const n = Math.max(1, c.lines.length);
      return n * lineH + padY * 2;
    });

    const bounds = { width: canvas.width, height: canvas.height };
    const rectsOverlap = (
      a: { x: number; y: number; w: number; h: number },
      b: { x: number; y: number; w: number; h: number },
      pad = 1,
    ) =>
      !(
        a.x + a.w + pad <= b.x ||
        b.x + b.w + pad <= a.x ||
        a.y + a.h + pad <= b.y ||
        b.y + b.h + pad <= a.y
      );
    const rectIntersectsCircle = (
      rect: { x: number; y: number; w: number; h: number },
      c: { cx: number; cy: number; r: number },
    ) => {
      const cx2 = Math.max(rect.x, Math.min(c.cx, rect.x + rect.w));
      const cy2 = Math.max(rect.y, Math.min(c.cy, rect.y + rect.h));
      const dx = c.cx - cx2;
      const dy = c.cy - cy2;
      return dx * dx + dy * dy < c.r * c.r;
    };
    const segmentsIntersect = (
      a1: { x: number; y: number },
      a2: { x: number; y: number },
      b1: { x: number; y: number },
      b2: { x: number; y: number },
    ) => {
      const d = (a2.x - a1.x) * (b2.y - b1.y) - (a2.y - a1.y) * (b2.x - b1.x);
      if (Math.abs(d) < 1e-9) return false;
      const t = ((b1.x - a1.x) * (b2.y - b1.y) - (b1.y - a1.y) * (b2.x - b1.x)) / d;
      const u = ((b1.x - a1.x) * (a2.y - a1.y) - (b1.y - a1.y) * (a2.x - a1.x)) / d;
      return t > 0.02 && t < 0.98 && u > 0.02 && u < 0.98;
    };
    const rectIntersectsSegment = (
      rect: { x: number; y: number; w: number; h: number },
      p1: { x: number; y: number },
      p2: { x: number; y: number },
    ) => {
      const inside = (p: { x: number; y: number }) =>
        p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h;
      if (inside(p1) || inside(p2)) return true;
      const tl = { x: rect.x, y: rect.y };
      const tr = { x: rect.x + rect.w, y: rect.y };
      const bl = { x: rect.x, y: rect.y + rect.h };
      const br = { x: rect.x + rect.w, y: rect.y + rect.h };
      return (
        segmentsIntersect(p1, p2, tl, tr) ||
        segmentsIntersect(p1, p2, tr, br) ||
        segmentsIntersect(p1, p2, br, bl) ||
        segmentsIntersect(p1, p2, bl, tl)
      );
    };
    const leaderEndpoints = (cand: Cand, anchor: { cx: number; cy: number }) => ({
      a: { x: anchor.cx, y: anchor.cy },
      b: { x: cand.x + cand.w / 2, y: cand.y + cand.h / 2 },
    });

    const genCandidates = (c: Circle, w: number, h: number): Cand[] => {
      const out: Cand[] = [];
      const fallback: Cand[] = [];
      const directions = 32;
      const rings = 6;
      for (let ring = 0; ring < rings; ring++) {
        const dist = c.r + gap + ring * Math.max(6, h * 0.5);
        for (let i = 0; i < directions; i++) {
          const angle = -Math.PI / 2 + (i * 2 * Math.PI) / directions;
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          const labelCx = c.cx + cos * dist;
          const labelCy = c.cy + sin * dist;
          let lx = labelCx - w / 2;
          let ly = labelCy - h / 2;
          lx = Math.max(2, Math.min(bounds.width - w - 2, lx));
          ly = Math.max(2, Math.min(bounds.height - h - 2, ly));
          const ax = c.cx + cos * c.r;
          const ay = c.cy + sin * c.r;
          const ex = Math.max(lx, Math.min(c.cx, lx + w));
          const ey = Math.max(ly, Math.min(c.cy, ly + h));
          const leader = Math.hypot(ex - ax, ey - ay);
          const cand = { x: lx, y: ly, w, h, ax, ay, leader };
          // Clamping to canvas bounds can push a label back on top of its own
          // anchor circle when the circle sits near an edge. Reject those so
          // the optimizer never picks a position that overlaps its own dot.
          if (rectIntersectsCircle(cand, c)) {
            fallback.push(cand);
          } else {
            out.push(cand);
          }
        }
      }
      return out.length > 0 ? out : fallback;
    };

    const candidatesPerLabel = circles.map((c, i) => genCandidates(c, widths[i], heights[i]));

    const OVERLAP_PENALTY = 100_000;
    const CIRCLE_PENALTY = 100_000;
    const LEADER_CROSS_PENALTY = 80_000;
    const LABEL_ON_LEADER_PENALTY = 90_000;

    const cost = (cand: Cand, selfIdx: number, positions: Cand[]) => {
      const self = circles[selfIdx];
      const labelCx = cand.x + cand.w / 2;
      const labelCy = cand.y + cand.h / 2;
      const dy = labelCy - self.cy;
      const dx = labelCx - self.cx;
      const belowPenalty = Math.max(0, dy) * 1.5;
      const rightPenalty = Math.max(0, dx) * 0.75;
      let c = cand.leader + Math.abs(dx) * 0.5 + belowPenalty + rightPenalty;
      for (let j = 0; j < positions.length; j++) {
        if (j === selfIdx) continue;
        if (rectsOverlap(cand, positions[j])) c += OVERLAP_PENALTY;
      }
      for (let j = 0; j < circles.length; j++) {
        if (j === selfIdx) continue;
        if (rectIntersectsCircle(cand, circles[j])) c += CIRCLE_PENALTY;
      }
      const myLeader = leaderEndpoints(cand, self);
      for (let j = 0; j < positions.length; j++) {
        if (j === selfIdx) continue;
        const otherAnchor = circles[j];
        const otherLeader = leaderEndpoints(positions[j], otherAnchor);
        if (rectIntersectsSegment(cand, otherLeader.a, otherLeader.b)) {
          c += LABEL_ON_LEADER_PENALTY;
        }
        if (segmentsIntersect(myLeader.a, myLeader.b, otherLeader.a, otherLeader.b)) {
          c += LEADER_CROSS_PENALTY;
        }
      }
      return c;
    };

    const positions: Cand[] = candidatesPerLabel.map((cands) =>
      cands.reduce((best, c) => (c.leader < best.leader ? c : best), cands[0]),
    );
    for (let iter = 0; iter < 8; iter++) {
      let improved = false;
      for (let i = 0; i < positions.length; i++) {
        let bestCand = positions[i];
        let bestCost = cost(bestCand, i, positions);
        for (const cand of candidatesPerLabel[i]) {
          const cc = cost(cand, i, positions);
          if (cc < bestCost - 0.01) {
            bestCost = cc;
            bestCand = cand;
          }
        }
        if (bestCand !== positions[i]) {
          positions[i] = bestCand;
          improved = true;
        }
      }
      if (!improved) break;
    }
    // Hard-filter: swap out any label still occluding another circle.
    for (let i = 0; i < positions.length; i++) {
      const hits = (cand: Cand) => {
        for (let j = 0; j < circles.length; j++) {
          if (j === i) continue;
          if (rectIntersectsCircle(cand, circles[j])) return true;
        }
        return false;
      };
      if (!hits(positions[i])) continue;
      let best: Cand | null = null;
      for (const cand of candidatesPerLabel[i]) {
        if (hits(cand)) continue;
        if (!best || cand.leader < best.leader) best = cand;
      }
      if (best) positions[i] = best;
    }

    // Draw leader lines first (behind circles/labels).
    ctx.lineWidth = Math.max(1, Math.round(canvas.width * 0.0009));
    for (let i = 0; i < circles.length; i++) {
      if (!circles[i].label) continue;
      const c = circles[i];
      const p = positions[i];
      const labelCx = p.x + p.w / 2;
      const labelCy = p.y + p.h / 2;
      const dx = labelCx - p.ax;
      const dy = labelCy - p.ay;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const halfW = p.w / 2;
      const halfH = p.h / 2;
      const tX = Math.abs(ux) > 1e-6 ? halfW / Math.abs(ux) : Infinity;
      const tY = Math.abs(uy) > 1e-6 ? halfH / Math.abs(uy) : Infinity;
      const tEdge = Math.min(tX, tY);
      const x2 = labelCx - ux * tEdge;
      const y2 = labelCy - uy * tEdge;
      const leaderLen = Math.hypot(x2 - p.ax, y2 - p.ay);
      if (leaderLen < 0.5) continue;
      ctx.strokeStyle = withAlpha(c.color, 0.7);
      ctx.beginPath();
      ctx.moveTo(p.ax, p.ay);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    // Draw circles.
    for (const c of circles) {
      ctx.beginPath();
      ctx.arc(c.cx, c.cy, c.r, 0, Math.PI * 2);
      ctx.fillStyle = withAlpha(c.color, 0.2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(c.cx, c.cy, c.r + 1, 0, Math.PI * 2);
      ctx.lineWidth = 1.25;
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(c.cx, c.cy, c.r, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = withAlpha(c.color, 0.7);
      ctx.stroke();
    }

    // Draw labels last.
    ctx.font = labelFont;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    for (let i = 0; i < circles.length; i++) {
      if (!circles[i].label) continue;
      const c = circles[i];
      const p = positions[i];
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = c.color;
      roundRect(ctx, p.x, p.y, p.w, p.h, 3);
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = readableTextOn(c.color);
      // Render each line stacked vertically inside the pill.
      const n = c.lines.length || 1;
      const firstY = p.y + padY + lineH / 2;
      for (let li = 0; li < c.lines.length; li++) {
        ctx.fillText(c.lines[li], p.x + padX, firstY + li * lineH + 1);
      }
      void n;
    }
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
    const key = renderKeyFor(pr);
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
