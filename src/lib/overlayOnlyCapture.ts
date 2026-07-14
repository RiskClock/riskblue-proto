// Overlay-only capture.
//
// Renders the shared OverlayLayer (circles, rects, labels, leaders) offscreen
// at a given pageSize, then rasterizes the placed DOM to a transparent PNG.
//
// This exists because mounting the full DrawingViewer offscreen for every
// export page is fragile (react-zoom-pan-pinch measurements, pdf.js worker,
// long timeouts). The overlay layer alone has no dependency on pdf.js or on
// wrapper libraries — it only needs a pageSize and an array of overlays to
// lay out labels and draw markers. That makes it reliable, cheap, and
// deterministic.
//
// Consumers:
//   - `pdfPageOverlayExport.buildAnnotatedPdf` — stamps the overlay PNG onto
//     the original PDF page (per-page and bulk export).
//   - `threatReportExport.runThreatReportExport` — composites overlay PNG on
//     top of a pdf.js raster of the same page to embed in the DOCX.

import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { OverlayLayer } from "@/components/viewer/OverlayLayer";
import {
  rotateNormalizedRect,
  toNormalizedRect,
  type NormalizedOverlay,
  type OverlayInput,
} from "@/components/viewer/viewerGeometry";
import { rasterizeViewerSurface, type RasterizedPage } from "./threatReportPageCapture";

/** Multiplier applied to overlay geometry when rendering for export. */
export const EXPORT_OVERLAY_SCALE = 1.5;

export interface OverlayOnlyCaptureInput {
  /** CSS pixel size to lay out overlays in. Match the target composite dims. */
  pageSize: { width: number; height: number };
  overlays: OverlayInput[] | any[];
  /** Output canvas scale factor. Default: 2. */
  outScale?: number;
  /** Multiplier for overlay geometry (borders, fonts, dot size). Default: EXPORT_OVERLAY_SCALE. */
  exportScale?: number;
  /**
   * Optional user rotation (0/90/180/270 CW) applied to the overlay layout
   * before rendering. Overlay rects are rotated into the rotated view and
   * `pageSize` is swapped when the rotation is 90/270, so the label
   * optimizer places pills correctly for the final rotated composition.
   * The resulting PNG matches the rotated view's dimensions; callers must
   * stamp it onto the source page accounting for that rotation.
   */
  userRotationDeg?: 0 | 90 | 180 | 270;
}


function normalizeOverlays(overlays: any[]): NormalizedOverlay[] {
  const out: NormalizedOverlay[] = [];
  for (const o of overlays) {
    const rect = toNormalizedRect(o as OverlayInput);
    if (!rect) continue;
    out.push({
      id: String(o.id),
      page: o.page ?? 1,
      rect,
      color: o.color,
      label: o.label,
      shape: (o.shape as any) ?? "circle",
      variant: o.variant,
    });
  }
  return out;
}

export async function captureOverlayOnly(
  input: OverlayOnlyCaptureInput,
): Promise<RasterizedPage | null> {
  const { pageSize } = input;
  const outScale = input.outScale ?? 2;
  const exportScale = input.exportScale ?? EXPORT_OVERLAY_SCALE;
  const normalized = normalizeOverlays(input.overlays);

  const container = document.createElement("div");
  container.style.cssText = [
    "position:fixed",
    "left:0",
    "top:0",
    "opacity:0",
    "pointer-events:none",
    "z-index:-1",
    `width:${pageSize.width}px`,
    `height:${pageSize.height}px`,
  ].join(";");
  const surface = document.createElement("div");
  surface.style.cssText = `position:relative;width:${pageSize.width}px;height:${pageSize.height}px;`;
  // Include a fake <img> element so rasterizeViewerSurface can anchor its
  // toLocal(x,y) mapping. The img is 1x1 transparent, sized to pageSize via
  // width/height attributes — this gives it a bounding rect we can measure.
  const anchorImg = document.createElement("img");
  anchorImg.src =
    "data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=";
  anchorImg.style.cssText = `display:block;width:${pageSize.width}px;height:${pageSize.height}px;pointer-events:none;`;
  surface.appendChild(anchorImg);
  const overlayHost = document.createElement("div");
  overlayHost.style.cssText = "position:absolute;inset:0;pointer-events:none;";
  surface.appendChild(overlayHost);
  container.appendChild(surface);
  document.body.appendChild(container);

  const root = createRoot(overlayHost);
  try {
    root.render(
      createElement(OverlayLayer, {
        overlays: normalized,
        pageSize,
        exportScale,
      } as any),
    );

    // Wait for React to commit + layout to settle.
    await new Promise<void>((r) =>
      requestAnimationFrame(() => requestAnimationFrame(() => r())),
    );
    // Extra RAF for label optimizer's useMemo second pass.
    await new Promise<void>((r) =>
      requestAnimationFrame(() => requestAnimationFrame(() => r())),
    );

    // Wait for the anchor img to be laid out.
    if (!anchorImg.clientWidth || !anchorImg.clientHeight) {
      await new Promise((r) => setTimeout(r, 30));
    }

    return await rasterizeViewerSurface(surface, {
      outScale,
      overlaysOnly: true,
      labelCounterRotationDeg: input.labelCounterRotationDeg,
    });
  } catch (e) {
    console.warn("[overlayOnlyCapture] failed", e);
    return null;
  } finally {
    try {
      root.unmount();
    } catch {
      /* ignore */
    }
    try {
      container.remove();
    } catch {
      /* ignore */
    }
  }
}
