/**
 * Shared geometry utilities for the DrawingViewer.
 *
 * Coordinate spaces supported:
 *  - 'normalized' : [x, y, w, h] OR [x1, y1, x2, y2] in 0..1 of the rendered page
 *  - 'pdf-points' : [x1, y1, x2, y2] in PDF user space (origin bottom-left, points)
 *  - 'pixels'     : [x1, y1, x2, y2] in raster pixels of the offscreen render
 *
 * All overlays are normalized into a 'normalized rect' { nx, ny, nw, nh } that
 * lives in 0..1 of the rendered page, so they can be transformed together with
 * the page surface by react-zoom-pan-pinch.
 */

import type { PageViewport } from "pdfjs-dist";

export type CoordSpace = "normalized" | "pdf-points" | "pixels";

/**
 * Overlay shape model.
 *  - "rect"   : bordered translucent rectangle sized to the bbox. Use for
 *               region/extent highlights (e.g. table-row hits in raw results).
 *  - "circle" : translucent disc with outline, centered on the bbox centroid.
 *               Use for exact-location emphasis (single instance markers).
 *               Geometry is anchored in document (normalized 0..1) space so it
 *               scales consistently across page sizes / fit modes / raster
 *               resolutions; a CSS minimum diameter only kicks in for visual
 *               legibility on tiny bboxes.
 */
export type OverlayShape = "rect" | "circle";

export type BBoxArray =
  | [number, number, number, number]
  | number[];

export interface NormalizedRect {
  nx: number; // 0..1
  ny: number; // 0..1
  nw: number; // 0..1
  nh: number; // 0..1
  /** Original rendered-page CSS pixel rect, when the caller supplied one. */
  px?: { x: number; y: number; w: number; h: number };
}

export interface OverlayInput {
  id: string;
  bbox: BBoxArray;
  coordSpace: CoordSpace;
  page?: number;
  /** For 'pixels' space: the raster (offscreen) size the bbox was measured in. */
  pixelSize?: { w: number; h: number };
  /** For 'pdf-points' space: the page's PageViewport at render time. */
  pdfViewport?: PageViewport;
  color?: string;
  label?: string;
  /** Defaults to 'rect' when omitted. */
  shape?: OverlayShape;
  /**
   * Optional rendering variant. "dot" = small filled disc, no border, no
   * label, no leader line. Used for lightweight markers such as unit-plan
   * region indicators placed inside a level-plan bbox.
   */
  variant?: "dot";
}

export interface NormalizedOverlay {
  id: string;
  page: number;
  rect: NormalizedRect;
  shape: OverlayShape;
  color?: string;
  label?: string;
  variant?: "dot";
}

/** Detect whether a 4-tuple looks like [x, y, w, h] (all <= 1) vs [x1, y1, x2, y2]. */
function looksLikeXYWHNormalized(b: BBoxArray): boolean {
  if (b.length !== 4) return false;
  return b.every((v) => v >= 0 && v <= 1);
}

/** Convert an overlay input into a normalized 0..1 rect on its page. */
export function toNormalizedRect(input: OverlayInput): NormalizedRect | null {
  const b = input.bbox;
  if (!b || b.length < 4) return null;

  if (input.coordSpace === "normalized") {
    if (looksLikeXYWHNormalized(b)) {
      const [x, y, w, h] = b;
      return { nx: x, ny: y, nw: w, nh: h };
    }
    // [x1, y1, x2, y2] in 0..1
    const [x1, y1, x2, y2] = b;
    return {
      nx: Math.min(x1, x2),
      ny: Math.min(y1, y2),
      nw: Math.abs(x2 - x1),
      nh: Math.abs(y2 - y1),
    };
  }

  if (input.coordSpace === "pixels") {
    if (!input.pixelSize) return null;
    const [x1, y1, x2, y2] = b;
    const { w, h } = input.pixelSize;
    const x = Math.min(x1, x2);
    const y = Math.min(y1, y2);
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);
    return {
      nx: x / w,
      ny: y / h,
      nw: width / w,
      nh: height / h,
      px: { x, y, w: width, h: height },
    };
  }

  if (input.coordSpace === "pdf-points") {
    if (!input.pdfViewport) return null;
    const [x1, y1, x2, y2] = b;
    const vr = input.pdfViewport.convertToViewportRectangle([x1, y1, x2, y2]);
    const [vx1, vy1, vx2, vy2] = vr;
    const w = input.pdfViewport.width;
    const h = input.pdfViewport.height;
    return {
      nx: Math.min(vx1, vx2) / w,
      ny: Math.min(vy1, vy2) / h,
      nw: Math.abs(vx2 - vx1) / w,
      nh: Math.abs(vy2 - vy1) / h,
    };
  }

  return null;
}

/** Compute target transform (scale + translate) to fit a normalized rect inside a viewport. */
export interface FitTarget {
  scale: number;
  positionX: number;
  positionY: number;
}

export function computeFitToRect(opts: {
  rect: NormalizedRect;
  pageSize: { width: number; height: number }; // rendered (CSS) page size at scale 1
  viewportSize: { width: number; height: number };
  paddingRatio?: number; // 0.2 = 20%
  minScale?: number;
  maxScale?: number;
}): FitTarget {
  const { rect, pageSize, viewportSize } = opts;
  const padding = opts.paddingRatio ?? 0.2;
  const minScale = opts.minScale ?? 1;
  const maxScale = opts.maxScale ?? 8;

  const targetW = Math.max(1, rect.nw * pageSize.width * (1 + padding));
  const targetH = Math.max(1, rect.nh * pageSize.height * (1 + padding));

  const scaleX = viewportSize.width / targetW;
  const scaleY = viewportSize.height / targetH;
  const scale = Math.min(maxScale, Math.max(minScale, Math.min(scaleX, scaleY)));

  // Center of the bbox in page coordinates (CSS px, scale 1)
  const centerPageX = (rect.nx + rect.nw / 2) * pageSize.width;
  const centerPageY = (rect.ny + rect.nh / 2) * pageSize.height;

  // react-zoom-pan-pinch positionX/Y is the translation applied BEFORE scaling
  // around the wrapper origin. To center (centerPageX, centerPageY) in the
  // viewport, we want: centerPageX * scale + positionX = viewportW / 2.
  const positionX = viewportSize.width / 2 - centerPageX * scale;
  const positionY = viewportSize.height / 2 - centerPageY * scale;

  return { scale, positionX, positionY };
}
