// Shared "render a DrawingViewer page to PNG" helper.
//
// Two consumers:
//   1. DrawingPageBlock's in-app "Download" button — passes an already-mounted
//      viewer surface (`rasterizeViewerSurface`).
//   2. Threat Report DOCX export — has no mounted viewer, so it mounts one
//      offscreen via `capturePageToPng`, waits for it to lay out, then calls
//      `rasterizeViewerSurface` on the offscreen surface.
//
// Both paths therefore use the exact same DOM read-back drawing routine, so
// the exported bitmap is pixel-for-pixel identical to the viewer.

import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { DrawingViewer, type DocumentSourceDescriptor } from "@/components/viewer";

// ---------------------------------------------------------------------------
// DOM read-back rasterizer
// ---------------------------------------------------------------------------
// Given a viewer surface element that contains an <img> (the rasterized PDF
// page) and an OverlayLayer subtree (with `[data-overlay-root]`), redraw
// everything onto a canvas by reading back the placed DOM. This guarantees
// parity with what the user sees on screen — same PDF raster, same overlay
// positions, same label optimizer output, same clamping.

export interface RasterizeOptions {
  /** Output canvas scale factor over the CSS layout size. Default: 2. */
  outScale?: number;
  /**
   * When true, skip drawing the underlying PDF raster and produce a
   * transparent PNG containing only the overlays. Used by the vector-PDF
   * export path (overlays are stamped onto the original PDF page).
   */
  overlaysOnly?: boolean;
  /**
   * Optional CCW rotation (degrees) applied to each label pill around its
   * own center when rasterizing. Circles/rects/leaders are drawn normally.
   * Used by the vector-PDF export when the page is baked with a user
   * rotation so the labels stay upright after the PDF viewer rotates the
   * whole page.
   */
  labelCounterRotationDeg?: number;
}

export interface RasterizedPage {
  blob: Blob;
  width: number;
  height: number;
}

export async function rasterizeViewerSurface(
  surfaceEl: HTMLElement,
  opts: RasterizeOptions = {},
): Promise<RasterizedPage> {
  const outScale = opts.outScale ?? 2;
  const overlaysOnly = !!opts.overlaysOnly;

  const pageImg = surfaceEl.querySelector("img") as HTMLImageElement | null;
  if (!pageImg) throw new Error("Drawing not yet loaded.");
  const imgRect = pageImg.getBoundingClientRect();
  // Use BCR (which reflects CSS transforms including rotation) so the output
  // canvas matches what the user sees on screen. clientWidth/clientHeight
  // would return the pre-rotation layout size and misalign the overlays.
  const cssW = imgRect.width;
  const cssH = imgRect.height;
  if (!cssW || !cssH) throw new Error("Drawing not yet loaded.");

  // Detect rotation from the img's inline transform (see DocumentSurface).
  const rotMatch = /rotate\((-?\d+)deg\)/.exec(pageImg.style.transform || "");
  const rotationDeg = rotMatch ? ((parseInt(rotMatch[1], 10) % 360) + 360) % 360 : 0;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(cssW * outScale);
  canvas.height = Math.round(cssH * outScale);
  const ctx = canvas.getContext("2d")!;
  if (!overlaysOnly) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  if (!overlaysOnly) {
    // Reload the image to bypass any tainted decode state.
    const sourceImg: HTMLImageElement = await new Promise((resolve, reject) => {
      const im = new Image();
      im.crossOrigin = "anonymous";
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error("Could not load page image."));
      im.src = pageImg.src;
    });
    if (rotationDeg) {
      const swap = rotationDeg === 90 || rotationDeg === 270;
      const drawW = swap ? canvas.height : canvas.width;
      const drawH = swap ? canvas.width : canvas.height;
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((rotationDeg * Math.PI) / 180);
      ctx.drawImage(sourceImg, -drawW / 2, -drawH / 2, drawW, drawH);
      ctx.restore();
    } else {
      ctx.drawImage(sourceImg, 0, 0, canvas.width, canvas.height);
    }
  }

  const toLocal = (clientX: number, clientY: number) => ({
    x: (clientX - imgRect.left) * outScale,
    y: (clientY - imgRect.top) * outScale,
  });



  // Leader lines (SVG) — map SVG coords → client via getScreenCTM.
  const leaderLines = surfaceEl.querySelectorAll<SVGLineElement>(
    'line[data-export-kind="leader"]',
  );
  leaderLines.forEach((line) => {
    const color = line.getAttribute("data-color") || "#dc2626";
    const opacity = Number(line.getAttribute("data-opacity") || "0.7");
    const svg = line.ownerSVGElement;
    if (!svg) return;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const pt1 = svg.createSVGPoint();
    pt1.x = Number(line.getAttribute("x1") || 0);
    pt1.y = Number(line.getAttribute("y1") || 0);
    const pt2 = svg.createSVGPoint();
    pt2.x = Number(line.getAttribute("x2") || 0);
    pt2.y = Number(line.getAttribute("y2") || 0);
    const p1 = pt1.matrixTransform(ctm);
    const p2 = pt2.matrixTransform(ctm);
    const a = toLocal(p1.x, p1.y);
    const b = toLocal(p2.x, p2.y);
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5 * outScale;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  });

  // Circles.
  const circles = surfaceEl.querySelectorAll<HTMLDivElement>(
    '[data-export-kind="circle"]',
  );
  circles.forEach((div) => {
    const r = div.getBoundingClientRect();
    const center = toLocal(r.left + r.width / 2, r.top + r.height / 2);
    const radius = (r.width / 2) * outScale;
    const color = div.getAttribute("data-color") || "#dc2626";
    const isDot = div.getAttribute("data-is-dot") === "1";
    ctx.save();
    if (isDot) {
      // Unit-floor-plan dot: translucent filled disc, no border.
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.5;
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius - 1.25 * outScale, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.35;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
      ctx.lineWidth = 1 * outScale;
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius - 1.25 * outScale, 0, Math.PI * 2);
      ctx.lineWidth = 2.5 * outScale;
      ctx.strokeStyle = color;
      ctx.stroke();
    }
    ctx.restore();
  });

  // Rectangles (Detail-N floor-plan bboxes). Match OverlayLayer's border-only
  // style: 50%-alpha stroke at the recorded border width.
  const rects = surfaceEl.querySelectorAll<HTMLDivElement>(
    '[data-export-kind="rect"]',
  );
  rects.forEach((div) => {
    const r = div.getBoundingClientRect();
    const tl = toLocal(r.left, r.top);
    const w = r.width * outScale;
    const h = r.height * outScale;
    const color = div.getAttribute("data-color") || "#dc2626";
    const borderPx = Number(div.getAttribute("data-border-px") || "2") * outScale;
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = color;
    ctx.lineWidth = borderPx;
    // Stroke inset by half the line width so the visible edge aligns with the
    // CSS box-sizing:border-box rect (which draws the border inside the box).
    ctx.strokeRect(
      tl.x + borderPx / 2,
      tl.y + borderPx / 2,
      Math.max(0, w - borderPx),
      Math.max(0, h - borderPx),
    );
    ctx.restore();
  });

  // Irregular polygon bboxes. Points are in the SVG's local user space, so
  // map each one through the live screen CTM before converting to canvas.
  const polys = surfaceEl.querySelectorAll<SVGPolygonElement>(
    '[data-export-kind="polygon"]',
  );
  polys.forEach((poly) => {
    const raw = poly.getAttribute("data-points") || poly.getAttribute("points") || "";
    const pts = raw
      .trim()
      .split(/\s+/)
      .map((pair) => pair.split(",").map(Number))
      .filter((p) => p.length === 2 && p.every((n) => Number.isFinite(n)));
    if (pts.length < 3) return;
    const svg = poly.ownerSVGElement;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return;
    const color = poly.getAttribute("data-color") || "#dc2626";
    const borderPx = Number(poly.getAttribute("data-border-px") || "2") * outScale;
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = color;
    ctx.lineWidth = borderPx;
    ctx.lineJoin = "round";
    ctx.beginPath();
    pts.forEach(([px, py], i) => {
      const sp = svg.createSVGPoint();
      sp.x = px;
      sp.y = py;
      const screen = sp.matrixTransform(ctm);
      const local = toLocal(screen.x, screen.y);
      if (i === 0) ctx.moveTo(local.x, local.y);
      else ctx.lineTo(local.x, local.y);
    });
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  });




  // Labels (pill + text) — draw fully opaque on an offscreen canvas, then
  // composite at the configured opacity to match CSS group-opacity.
  const labels = surfaceEl.querySelectorAll<HTMLDivElement>(
    '[data-export-kind="label"]',
  );
  labels.forEach((div) => {
    const r = div.getBoundingClientRect();
    const tl = toLocal(r.left, r.top);
    const domW = r.width * outScale;
    const h = r.height * outScale;
    const bg = div.getAttribute("data-color") || "#dc2626";
    const textColor = div.getAttribute("data-text-color") || "#ffffff";
    const opacity = Number(div.getAttribute("data-opacity") || "0.7");
    const rawText = (div.textContent || "").trim();
    // Preserve multi-line labels (viewer renders newlines as <br>).
    const lines = rawText.split(/\r?\n/);

    // Trust the DOM: paint with the font size / line-height the pill was
    // actually laid out with, so text can never overflow its own box.
    const cs = getComputedStyle(div);
    const domFontPx = parseFloat(cs.fontSize);
    const attrFontPx = Number(div.getAttribute("data-font-px") || "0");
    let fontPx =
      (Number.isFinite(domFontPx) && domFontPx > 0 ? domFontPx : attrFontPx || 11) *
      outScale;
    const domLineH = parseFloat(cs.lineHeight);
    let lineH =
      (Number.isFinite(domLineH) && domLineH > 0 ? domLineH : parseFloat(cs.fontSize) * 1.25) *
      outScale;

    const padXCss = parseFloat(cs.paddingLeft);
    const padX = (Number.isFinite(padXCss) ? padXCss : 4) * outScale;

    const fontFor = (px: number) =>
      `bold ${px}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;

    // If canvas metrics still measure the text wider than the DOM pill
    // (font fallback mismatch), shrink the drawn font rather than growing
    // the pill — growing it would break the collision footprint the label
    // optimizer reserved and cause neighbouring labels to overlap.
    const probe = document.createElement("canvas").getContext("2d")!;
    const measureMax = (px: number) => {
      probe.font = fontFor(px);
      let max = 0;
      for (const ln of lines) {
        const tw = probe.measureText(ln).width;
        if (tw > max) max = tw;
      }
      return max;
    };
    const avail = Math.max(1, domW - padX * 2);
    const measured = measureMax(fontPx);
    if (measured > avail) {
      const shrink = Math.max(0.5, avail / measured);
      fontPx = fontPx * shrink;
      lineH = lineH * shrink;
    }
    // Never let the stacked lines exceed the pill height.
    if (lines.length > 1 && lineH * lines.length > h) {
      lineH = h / lines.length;
      fontPx = Math.min(fontPx, lineH / 1.25);
    }

    const fontStr = fontFor(fontPx);
    const w = domW;
    const drawX = tl.x;

    const off = document.createElement("canvas");
    off.width = Math.max(1, Math.ceil(w));
    off.height = Math.max(1, Math.ceil(h));
    const octx = off.getContext("2d")!;
    // Sharp-cornered rectangle (matches on-screen bbox label spec).
    octx.fillStyle = bg;
    octx.fillRect(0, 0, w, h);
    octx.lineWidth = 1 * outScale;
    octx.strokeStyle = "rgba(255,255,255,0.9)";
    octx.strokeRect(0.5, 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
    octx.fillStyle = textColor;
    octx.font = fontStr;
    octx.textAlign = "center";
    octx.textBaseline = "middle";
    if (lines.length <= 1) {
      octx.fillText(rawText, w / 2, h / 2);
    } else {
      const totalH = lineH * lines.length;
      const startY = h / 2 - totalH / 2 + lineH / 2;
      for (let i = 0; i < lines.length; i++) {
        octx.fillText(lines[i], w / 2, startY + i * lineH);
      }
    }

    ctx.save();
    ctx.globalAlpha = opacity;
    const labelRot = opts.labelCounterRotationDeg ?? 0;
    if (labelRot) {
      const cx = tl.x + domW / 2;
      const cy = tl.y + h / 2;
      ctx.translate(cx, cy);
      ctx.rotate((labelRot * Math.PI) / 180);
      ctx.drawImage(off, -w / 2, -h / 2);
    } else {
      ctx.drawImage(off, drawX, tl.y);
    }
    ctx.restore();
  });

  const blob: Blob = await new Promise((res, rej) =>
    canvas.toBlob(
      (b) => (b ? res(b) : rej(new Error("Canvas encoding failed."))),
      "image/png",
      0.95,
    ),
  );
  return { blob, width: canvas.width, height: canvas.height };
}

// ---------------------------------------------------------------------------
// Offscreen mount + capture (used by the DOCX exporter)
// ---------------------------------------------------------------------------

export interface CapturePageInput {
  source: DocumentSourceDescriptor;
  page: number;
  overlays: any[];
  /** Target long-edge pixels for the output PNG. Default: 1600. */
  targetLongEdgePx?: number;
  /** Wait timeout for viewer readiness. Default 30s. */
  timeoutMs?: number;
  /**
   * When true, output a transparent PNG of the overlays only (no PDF raster
   * underneath). Used by the vector-PDF export path which stamps overlays
   * onto the original PDF page.
   */
  overlaysOnly?: boolean;
  /** Optional visual rotation (degrees CW) applied to the captured page. */
  rotation?: 0 | 90 | 180 | 270;
}

export async function capturePageToPng(
  input: CapturePageInput,
): Promise<RasterizedPage | null> {
  const target = input.targetLongEdgePx ?? 1600;
  const outScale = 2;
  // Size the CSS container so `cssW * outScale ≈ target` on the long edge.
  // We don't know the page aspect ratio yet, so give a generous 4:3 canvas —
  // the viewer fits to whichever fits inside, preserving aspect.
  const cssLong = Math.round(target / outScale);
  const cssShort = Math.round(cssLong * 0.75);


  const container = document.createElement("div");
  container.setAttribute("data-threat-report-capture", "1");
  container.style.cssText = [
    "position:fixed",
    "left:-100000px",
    "top:0",
    `width:${cssLong}px`,
    `height:${cssLong}px`,
    "background:#ffffff",
    "pointer-events:none",
    "z-index:-1",
    "overflow:hidden",
  ].join(";");
  // Inner surface at cssLong x cssShort — matches the on-screen 3:2-ish frame.
  const surface = document.createElement("div");
  surface.style.cssText = `width:${cssLong}px; height:${cssShort}px; background:#ffffff;`;
  container.appendChild(surface);
  document.body.appendChild(container);

  const root = createRoot(surface);
  try {
    root.render(
      createElement(DrawingViewer, {
        source: input.source,
        page: input.page,
        overlays: input.overlays,
        rotation: input.rotation ?? 0,
        showToolbar: false,
        interactive: false,
      }),
    );


    const ready = await waitForViewerReady(surface, input.timeoutMs ?? 30000);
    if (!ready) return null;
    // Wait for custom fonts to be usable so DOM pill widths match Canvas
    // fillText widths in the rasterizer (prevents symmetric text clipping).
    try {
      if (typeof document !== "undefined" && (document as any).fonts) {
        await Promise.race([
          (document as any).fonts.ready,
          new Promise((r) => setTimeout(r, 500)),
        ]);
      }
    } catch { /* ignore */ }
    // Extra RAF pair after readiness so overlay layout settles.
    await new Promise<void>((r) =>
      requestAnimationFrame(() => requestAnimationFrame(() => r())),
    );
    return await rasterizeViewerSurface(surface, {
      outScale,
      overlaysOnly: input.overlaysOnly,
    });

  } catch (e) {
    console.warn("[threatReportPageCapture] capture failed", e);
    return null;
  } finally {
    try {
      root.unmount();
    } catch {
      // ignore
    }
    try {
      container.remove();
    } catch {
      // ignore
    }
  }
}

async function waitForViewerReady(
  surface: HTMLElement,
  timeoutMs: number,
): Promise<boolean> {
  const start = Date.now();
  let lastOverlayCount = -1;
  let stableTicks = 0;
  while (Date.now() - start < timeoutMs) {
    const img = surface.querySelector("img") as HTMLImageElement | null;
    const overlayRoot = surface.querySelector(
      "[data-overlay-root]",
    ) as HTMLElement | null;
    const imgReady =
      img && img.complete && img.naturalWidth > 0 && img.clientWidth > 0;
    if (imgReady && overlayRoot) {
      const count = overlayRoot.querySelectorAll(
        '[data-export-kind="circle"], [data-export-kind="label"], [data-export-kind="leader"]',
      ).length;
      // Wait for overlay layout to stabilize for two consecutive polls.
      if (count === lastOverlayCount) {
        stableTicks += 1;
        if (stableTicks >= 2) return true;
      } else {
        stableTicks = 0;
        lastOverlayCount = count;
      }
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  return false;
}
