import { CSSProperties, PointerEvent as ReactPointerEvent, memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { NormalizedOverlay } from "./viewerGeometry";
import { readableTextOn } from "@/lib/awpColor";
import {
  requestPlacement,
  runPlacement,
  type PlacedLabel,
} from "./overlayPlacementClient";




interface OverlayLayerProps {
  overlays: NormalizedOverlay[];
  /** Page CSS size at scale = 1 (the size the surface img is rendered at). */
  pageSize: { width: number; height: number };
  hoveredId?: string | null;
  /** Overlay rendered with a persistent selection ring. */
  selectedId?: string | null;
  /** Overlay rendered with a temporary attention pulse. */
  pulsingId?: string | null;
  /** Current viewport zoom scale. Labels divide by this to stay constant on-screen. */
  viewScale?: number;
  defaultColor?: string;
  /** When provided, clicking an overlay invokes this with its id. */
  onOverlayClick?: (id: string) => void;
  /**
   * When provided, dot overlays become draggable. Fires on pointer-up with
   * the new normalized (0..1) position. A pointer-up with no significant
   * movement still routes through onOverlayClick.
   */
  onOverlayDrag?: (id: string, nx: number, ny: number) => void;
  /**
   * Multiplier applied to circle diameters, label font/padding, leader
   * stroke width, and rect border widths. Used by the export capture path
   * to render chunkier overlays that read well in downloaded PDFs. Defaults
   * to 1 so the on-screen viewer is unaffected.
   */
  exportScale?: number;
  /**
   * When true, the label-placement optimizer runs synchronously during
   * render (via useMemo). Used by the offscreen export capture, which
   * rasterizes on the next rAF and can't wait for a deferred setState.
   * When false (default), placement runs asynchronously in a microtask so
   * mounting the viewer with many annotations doesn't block the main thread.
   */
  syncPlacement?: boolean;
  /**
   * Export-only: render labels at the same MAX font/padding the placement
   * optimizer reserved for them (instead of the zoom-interpolated size).
   * This keeps the rendered pill identical to its reserved footprint, so
   * the rasterizer never has to grow pills (which caused overlaps) and
   * multi-line pills are tall enough for every line (no clipping).
   */
  fullSizeLabels?: boolean;
  /**
   * Fired whenever the async placement pass starts (true) or finishes
   * (false). Consumers can use this to render a loading affordance on
   * side panels that let the user mutate annotations.
   */
  onPlacingChange?: (isPlacing: boolean) => void;
  /**
   * Viewer-only master switch for annotation labels + leader lines. When
   * false, only the anchor dots render. Bounding-box (rect) labels are
   * unaffected. Defaults to true.
   */
  showLabels?: boolean;
  /**
   * Currently visible region of the page in normalized (0..1) page coords.
   * When provided (viewer only), label placement is restricted to the
   * annotations/obstacles intersecting this rect (plus a buffer) so labels
   * don't dodge off-screen geometry. Omitted / null => no culling.
   */
  viewportRect?: { nx: number; ny: number; nw: number; nh: number } | null;
  /**
   * Settle-debounced zoom scale used for the placement pass only (pills still
   * render at the live `viewScale`). Keeps a zoom gesture from rerunning the
   * optimizer on every frame. Falls back to `viewScale` when omitted.
   */
  placementScale?: number;
}


const MIN_CIRCLE_DIAMETER_CSS = 24;

// Label sizing.
// The placement optimizer always uses the MAX label footprint (font=13, pad=4)
// so its collision layout stays stable regardless of the current viewport
// zoom. At render time, the actual font/padding are interpolated between a
// min (8px @ scale ≤ 1.2) and max (13px @ scale ≥ 3.0) so labels stay
// legible when zoomed out and grow smoothly when zoomed in — without ever
// exceeding the footprint the optimizer already reserved for them.
const LABEL_FONT_PX = 13; // MAX — used by optimizer for collision reservation
const LABEL_PAD_X = 4;
const LABEL_H = 19;
const LABEL_GAP = 0;
const LABEL_OPACITY = 0.85;

const LABEL_FONT_MIN_SCREEN = 8;
const LABEL_FONT_MAX_SCREEN = 13;
const LABEL_ZOOM_MIN = 1.2;
const LABEL_ZOOM_MAX = 3.0;
const CIRCLE_BORDER_PX_SCREEN = 3;
const LEADER_STROKE_PX_SCREEN = 2.25;

// ---- Placement tunables ---------------------------------------------------
// Anchors within this screen-space distance of each other form a cluster; the
// cluster-first allocator fans their labels out radially around the cluster
// centroid. Clusters dissolve as you zoom in.
const CLUSTER_PROXIMITY_PX = 60;
/** Zoom is quantized to this step so smooth pinch-zoom doesn't rerun placement. */
const LOD_SCALE_QUANTIZE = 0.1;
/**
 * Viewer-only soft cap on leader length, in screen px. Past this the placement
 * cost grows quadratically, so labels stay near their anchors instead of being
 * dragged into the crowded middle of the viewport. Exports are unaffected.
 */
const LEADER_SOFT_CAP_SCREEN_PX = 140;
/**
 * Viewer-only minimum leader length, in screen px. Labels are probed from this
 * distance outward so a pill never covers its own anchor dot.
 */
const MIN_LEADER_SCREEN_PX = 28;
/** Extra margin (fraction of the visible span) added around the viewport
 *  before culling placement inputs, so labels don't pop in at the edge. */
const VIEWPORT_BUFFER_RATIO = 0.2;
/**
 * Local-density LOD. An anchor with more than LOD_MAX_NEIGHBORS other labelled
 * anchors within LOD_NEIGHBOR_RADIUS_PX (screen px) is "low detail": no label,
 * no leader line, and its dot renders fully opaque. Zooming in thins the
 * neighbor counts, so labels return progressively.
 */
const LOD_NEIGHBOR_RADIUS_PX = 70;
const LOD_MAX_NEIGHBORS = 3;


/** Interpolate label sizing based on the current viewport zoom scale. */
function labelSizingForZoom(viewScale: number) {
  const s = Math.max(0.0001, viewScale);
  const t = Math.max(0, Math.min(1, (s - LABEL_ZOOM_MIN) / (LABEL_ZOOM_MAX - LABEL_ZOOM_MIN)));
  const font = LABEL_FONT_MIN_SCREEN + t * (LABEL_FONT_MAX_SCREEN - LABEL_FONT_MIN_SCREEN);
  // Padding scales with the font so the pill hugs the text tightly at
  // small sizes and breathes at larger ones.
  const padX = 1 + t * 3; // 1 → 4
  const padY = 0.5 + t * 1.5; // 0.5 → 2
  return { font, padX, padY, t };
}

// Shared canvas 2d context for true (font-metric-accurate) text measurement.
// Uses the exact same font stack the rasterizer paints with, so DOM pill
// widths and canvas fillText widths agree in the export path.
export const LABEL_CANVAS_FONT_STACK =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

let _measureCtx: CanvasRenderingContext2D | null = null;
function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (_measureCtx) return _measureCtx;
  if (typeof document === "undefined") return null;
  try {
    const c = document.createElement("canvas");
    _measureCtx = c.getContext("2d");
    return _measureCtx;
  } catch {
    return null;
  }
}
export function measureLabelWidthPx(text: string, fontPx: number): number | undefined {
  const ctx = getMeasureCtx();
  if (!ctx) return undefined;
  ctx.font = `bold ${fontPx}px ${LABEL_CANVAS_FONT_STACK}`;
  const lines = text.split("\n");
  let max = 0;
  for (const ln of lines) {
    const w = ctx.measureText(ln).width;
    if (w > max) max = w;
  }
  return max + 1; // +1px safety
}

function withAlpha(color: string, alpha: number): string {
  const trimmed = color.trim();
  if (trimmed.startsWith("hsl(") && trimmed.endsWith(")")) {
    return trimmed.replace(/\)$/, ` / ${alpha})`);
  }
  if (trimmed.startsWith("rgb(") && trimmed.endsWith(")")) {
    return trimmed.replace(/^rgb\((.*)\)$/, `rgba($1, ${alpha})`);
  }
  if (trimmed.startsWith("#")) {
    const hex = trimmed.slice(1);
    const normalized =
      hex.length === 3
        ? hex.split("").map((c) => `${c}${c}`).join("")
        : hex.length === 6
          ? hex
          : null;
    if (normalized) {
      const value = Number.parseInt(normalized, 16);
      const r = (value >> 16) & 255;
      const g = (value >> 8) & 255;
      const b = value & 255;
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
  }
  return trimmed;
}

interface CircleInfo {
  id: string;
  cx: number;
  cy: number;
  r: number;
  color: string;
  label?: string;
  hovered: boolean;
  /** Dot variant: filled disc, no border, no label. */
  isDot?: boolean;
}

// NOTE: Label-placement geometry (candidate generation, rbush spatial
// indexing, cost/optimizer) lives in ./overlayPlacement.ts so it can run
// inside a Web Worker off the main thread. See overlayPlacementClient.ts
// for the request/cancel API used below.

/**
 * Where a bbox label should dock. For plain rectangles that's the top-left
 * corner. For polygons the envelope's top-left corner can sit in empty space
 * (L-shaped / notched rooms), so we dock to the left end of the longest
 * near-horizontal edge in the upper part of the shape instead.
 */
export function polygonLabelAnchor(
  pts: { x: number; y: number }[] | undefined,
): { x: number; y: number } {
  if (!pts || pts.length < 3) return { x: 0, y: 0 };
  const ys = pts.map((p) => p.y);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const height = Math.max(1, maxY - minY);
  let best: { x: number; y: number; score: number } | null = null;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    if (dx < 1 || dy > dx * 0.35) continue; // not near-horizontal
    const top = Math.min(a.y, b.y);
    // Prefer long edges that sit close to the top of the shape.
    const score = dx * (1 - Math.min(1, (top - minY) / height) * 0.9);
    if (!best || score > best.score) {
      best = { x: Math.min(a.x, b.x), y: top, score };
    }
  }
  if (best) return { x: best.x, y: best.y };
  // Fall back to the topmost vertex (leftmost if tied).
  let top = pts[0];
  for (const p of pts) {
    if (p.y < top.y || (p.y === top.y && p.x < top.x)) top = p;
  }
  return { x: top.x, y: top.y };
}


// ---- Memoized child components --------------------------------------------
//
// Extracted so React can skip reconciling unchanged annotations when the
// hovered id changes. Only the previously-hovered and newly-hovered items
// re-render; the rest are bailed out by `React.memo`'s shallow-equal check.

interface RectOverlayProps {
  r: {
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
    color: string;
    label?: string;
    /** Polygon outline in page px, relative to the box origin (x, y). */
    pts?: { x: number; y: number }[];
    /** Label dock point in page px, relative to the box origin (x, y). */
    labelAnchor?: { x: number; y: number };
  };


  hovered: boolean;
  exportScale: number;
  /**
   * Current viewport zoom scale from react-zoom-pan-pinch. Because the
   * overlay layer sits *inside* the transformed content, we divide screen
   * sizes (border width, label font, padding) by this so borders stay a
   * constant ~2px and labels a constant ~12px on-screen regardless of
   * zoom. The box itself still scales with the drawing so it keeps
   * hugging the same physical region.
   */
  viewScale: number;
  /** See OverlayLayerProps.fullSizeLabels. */
  fullSizeLabels?: boolean;
}
const RectOverlay = memo(function RectOverlay({ r, hovered, exportScale, viewScale, fullSizeLabels }: RectOverlayProps) {
  const s = Math.max(0.0001, viewScale);
  const borderPxScreen = (hovered ? 3 : 2) * exportScale;
  // Border thickness is expressed in page units so it scales with zoom, the
  // same way the previous CSS border did.
  const borderPxPage = borderPxScreen;
  // Label docks to the top-left corner of the box like a header tab. It
  // shares the box's top-left origin so it visually "sits on" the border.
  const label = r.label ?? "";
  const sizing = labelSizingForZoom(viewScale);
  const fontCss = fullSizeLabels
    ? LABEL_FONT_PX * exportScale
    : (sizing.font / s) * exportScale;
  const padXCss = fullSizeLabels
    ? LABEL_PAD_X * exportScale
    : (sizing.padX / s) * exportScale;
  const padYCss = fullSizeLabels ? 2 * exportScale : (sizing.padY / s) * exportScale;
  const labelHCss = fontCss * 1.35 + padYCss * 2;
  const textColor = readableTextOn(r.color);
  return (
    <div style={{ position: "absolute", left: r.x, top: r.y, pointerEvents: "none" }}>
      <svg
        width={r.w}
        height={r.h}
        style={{ position: "absolute", left: 0, top: 0, overflow: "visible", pointerEvents: "none" }}
      >
        {r.pts && r.pts.length >= 3 ? (
          <polygon
            data-export-kind="polygon"
            data-color={r.color}
            data-border-px={borderPxScreen}
            data-points={r.pts.map((p) => `${p.x},${p.y}`).join(" ")}
            points={r.pts.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke={withAlpha(r.color, 0.5)}
            strokeWidth={borderPxPage}
            strokeLinejoin="round"
            style={{ strokeWidth: borderPxPage }}
          />
        ) : (
          <rect
            data-export-kind="rect"
            data-color={r.color}
            data-border-px={borderPxScreen}
            x={borderPxPage / 2}
            y={borderPxPage / 2}
            width={Math.max(0, r.w - borderPxPage)}
            height={Math.max(0, r.h - borderPxPage)}
            fill="none"
            stroke={withAlpha(r.color, 0.5)}
            strokeWidth={borderPxPage}
            style={{ strokeWidth: borderPxPage }}
          />
        )}


      </svg>
      {label ? (
        <div
          data-export-kind="label"
          data-color={r.color}
          data-text-color={textColor}
          data-x={r.x + (r.labelAnchor?.x ?? 0)}
          data-y={r.y + (r.labelAnchor?.y ?? 0)}
          data-font-px={fontCss}
          data-opacity={1}
          className="absolute font-bold pointer-events-none"
          style={{
            left: r.labelAnchor?.x ?? 0,
            top: r.labelAnchor?.y ?? 0,

            height: labelHCss,
            lineHeight: `${fontCss * 1.4}px`,
            fontSize: fontCss,
            paddingLeft: padXCss,
            paddingRight: padXCss,
            paddingTop: padYCss,
            paddingBottom: padYCss,
            boxSizing: "border-box",
            backgroundColor: r.color,
            color: textColor,
            whiteSpace: "nowrap",
            borderRadius: 0,
          }}
          title={label}
        >
          {label}
        </div>
      ) : null}
    </div>
  );
});

interface DragState {
  id: string;
  startClientX: number;
  startClientY: number;
  dx: number;
  dy: number;
  moved: boolean;
}
interface CircleOverlayProps {
  c: CircleInfo;
  hovered: boolean;
  selected?: boolean;
  pulsing?: boolean;
  exportScale: number;
  clickable: boolean;
  draggable: boolean;
  isDragging: boolean;
  dragDx: number;
  dragDy: number;
  viewScale: number;
  pageWidth: number;
  pageHeight: number;
  dragRef: React.MutableRefObject<DragState | null>;
  setDrag: (d: DragState | null) => void;
  onOverlayClick?: (id: string) => void;
  onOverlayDrag?: (id: string, nx: number, ny: number) => void;
  /** LOD suppressed this anchor's label — render it as a solid dot. */
  denseOpaque?: boolean;
}
const CircleOverlay = memo(function CircleOverlay(props: CircleOverlayProps) {
  const {
    c, hovered, selected = false, pulsing = false, exportScale, clickable, draggable, isDragging, dragDx, dragDy,
    viewScale, pageWidth, pageHeight, dragRef, setDrag, onOverlayClick, onOverlayDrag,
    denseOpaque = false,
  } = props;

  const dotBaseAlpha = draggable ? 0.5 : (hovered || selected ? 0.85 : 0.7);
  const style: CSSProperties = c.isDot
    ? {
        position: "absolute",
        left: c.cx - c.r + dragDx,
        top: c.cy - c.r + dragDy,
        width: c.r * 2,
        height: c.r * 2,
        borderRadius: "9999px",
        backgroundColor: withAlpha(c.color, dotBaseAlpha),
        boxSizing: "border-box",
        pointerEvents: clickable || draggable ? "auto" : "none",
        cursor: draggable ? (isDragging ? "grabbing" : "grab") : clickable ? "pointer" : undefined,
        touchAction: draggable ? "none" : undefined,
      }
    : {
        position: "absolute",
        left: c.cx - c.r + dragDx,
        top: c.cy - c.r + dragDy,
        width: c.r * 2,
        height: c.r * 2,
        // Border is rendered via SVG below with non-scaling-stroke so it
        // stays a constant pixel size regardless of ancestor CSS zoom
        // transforms. Keep the fill on the div so hit-testing works.
        borderRadius: "9999px",
        backgroundColor: withAlpha(
          c.color,
          selected ? 0.45 : hovered ? 0.35 : denseOpaque ? 1 : 0.2,
        ),
        boxSizing: "border-box",
        pointerEvents: clickable || draggable ? "auto" : "none",
        cursor: draggable ? (isDragging ? "grabbing" : "grab") : clickable ? "pointer" : undefined,
        touchAction: draggable ? "none" : undefined,
      };

  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  const DRAG_THRESHOLD = 5;

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!draggable) return;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    setDrag({ id: c.id, startClientX: e.clientX, startClientY: e.clientY, dx: 0, dy: 0, moved: false });
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggable) return;
    const cur = dragRef.current;
    if (!cur || cur.id !== c.id) return;
    const rawDx = e.clientX - cur.startClientX;
    const rawDy = e.clientY - cur.startClientY;
    const s = viewScale || 1;
    const dx = rawDx / s;
    const dy = rawDy / s;
    const moved = cur.moved || Math.hypot(rawDx, rawDy) >= DRAG_THRESHOLD;
    setDrag({ ...cur, dx, dy, moved });
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const cur = dragRef.current;
    if (draggable && cur && cur.id === c.id) {
      try { (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      if (cur.moved) {
        const newCx = c.cx + cur.dx;
        const newCy = c.cy + cur.dy;
        const nx = Math.max(0, Math.min(1, newCx / pageWidth));
        const ny = Math.max(0, Math.min(1, newCy / pageHeight));
        setDrag(null);
        onOverlayDrag!(c.id, nx, ny);
        return;
      }
      setDrag(null);
    }
    if (clickable) onOverlayClick!(c.id);
  };

  const strokePxScreen = (selected ? 4 : hovered ? 3 : CIRCLE_BORDER_PX_SCREEN) * exportScale;
  const strokePxPage = strokePxScreen / Math.max(0.0001, viewScale);

  return (
    <div
      data-export-kind="circle"
      data-is-dot={c.isDot ? "1" : "0"}
      className={draggable ? "overlay-draggable" : undefined}
      data-color={c.color}
      data-cx={c.cx}
      data-cy={c.cy}
      data-radius={c.r}
      style={style}
      onPointerDown={draggable ? onPointerDown : clickable ? stop : undefined}
      onPointerMove={draggable ? onPointerMove : undefined}
      onPointerUp={draggable ? onPointerUp : clickable ? stop : undefined}
      onClick={
        !draggable && clickable
          ? (e) => { e.stopPropagation(); onOverlayClick!(c.id); }
          : (e) => e.stopPropagation()
      }
    >
      {pulsing ? (
        <span
          aria-hidden
          style={{
            position: "absolute",
            inset: -c.r * 0.35,
            borderRadius: "9999px",
            backgroundColor: withAlpha(c.color, 0.45),
            pointerEvents: "none",
          }}
          className="animate-ping"
        />
      ) : null}
      {!c.isDot ? (
        <svg
          width={c.r * 2}
          height={c.r * 2}
          style={{ position: "absolute", inset: 0, overflow: "visible", pointerEvents: "none" }}
        >
          <circle
            cx={c.r}
            cy={c.r}
            r={Math.max(0, c.r - strokePxPage / 2)}
            fill="none"
            stroke={withAlpha(c.color, 0.5)}
            strokeWidth={strokePxPage}
            vectorEffect="non-scaling-stroke"
            style={{ vectorEffect: "non-scaling-stroke", strokeWidth: strokePxPage }}
          />
        </svg>
      ) : null}
    </div>
  );
});






export const OverlayLayer = ({
  overlays,
  pageSize,
  hoveredId,
  selectedId,
  pulsingId,
  viewScale = 1,
  defaultColor = "hsl(var(--destructive))",
  onOverlayClick,
  onOverlayDrag,
  exportScale = 1,
  syncPlacement = false,
  fullSizeLabels = false,
  onPlacingChange,
  showLabels = true,
  viewportRect = null,
  placementScale,


}: OverlayLayerProps) => {
  const [drag, setDrag] = useState<null | {
    id: string;
    startClientX: number;
    startClientY: number;
    dx: number;
    dy: number;
    moved: boolean;
  }>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;

  const onPlacingChangeRef = useRef(onPlacingChange);
  onPlacingChangeRef.current = onPlacingChange;

  const overlayRootRef = useRef<HTMLDivElement>(null);
  const labelRefMap = useRef<Map<string, HTMLDivElement>>(new Map());
  const leaderRefMap = useRef<Map<string, SVGLineElement>>(new Map());
  labelRefMap.current.clear();
  leaderRefMap.current.clear();

  const circles: CircleInfo[] = useMemo(() => {
    return overlays
      .filter((o) => (o.shape ?? "circle") !== "rect")
      .map((o) => {
        const color = o.color ?? defaultColor;
        const cx = (o.rect.nx + o.rect.nw / 2) * pageSize.width;
        const cy = (o.rect.ny + o.rect.nh / 2) * pageSize.height;
        const bboxSidePx = Math.max(
          o.rect.nw * pageSize.width,
          o.rect.nh * pageSize.height,
        );
        const isDot = o.variant === "dot";
        // Detection annotation circles are intentionally small (30% of the
        // previous size, then bumped 30% larger on request) so they don't
        // obscure the drawing. Unit-marker dots keep their original size.
        // `exportScale` bumps everything larger for downloaded PDFs.
        const baseDiameter = isDot
          ? Math.max(10, MIN_CIRCLE_DIAMETER_CSS * 0.55)
          : Math.max(MIN_CIRCLE_DIAMETER_CSS, bboxSidePx * 1.5) * 0.195;
        // Unit-marker dots get an extra 3× bump in the export path (where
        // exportScale > 1) so they read clearly on the full-page PDF raster.
        const dotExportBoost = isDot && exportScale > 1 ? 3 : 1;
        const diameter = baseDiameter * exportScale * dotExportBoost;

        return {
          id: o.id,
          cx,
          cy,
          r: diameter / 2,
          color,
          label: isDot ? undefined : o.label,
          // NOTE: `hovered` is intentionally not included here — recomputed
          // per-render in the JSX map so hover changes don't invalidate this
          // memo (which would rebuild every derived structure downstream).
          hovered: false,
          isDot,
        };
      });
  }, [overlays, pageSize.width, pageSize.height, defaultColor, exportScale]);

  const rects = useMemo(() => {
    return overlays
      .filter((o) => o.shape === "rect")
      .map((o) => {
        const x = o.rect.px?.x ?? o.rect.nx * pageSize.width;
        const y = o.rect.px?.y ?? o.rect.ny * pageSize.height;
        // Polygon points are absolute normalized page coords; convert to px
        // and rebase onto the box origin so they share the wrapper's offset.
        const pts =
          o.rect.points && o.rect.points.length >= 3
            ? o.rect.points.map((p) => ({
                x: p.nx * pageSize.width - x,
                y: p.ny * pageSize.height - y,
              }))
            : undefined;
        return {
          id: o.id,
          x,
          y,
          w: Math.max(1, o.rect.px?.w ?? o.rect.nw * pageSize.width),
          h: Math.max(1, o.rect.px?.h ?? o.rect.nh * pageSize.height),
          color: o.color ?? defaultColor,
          label: o.label,
          pts,
          labelAnchor: pts ? polygonLabelAnchor(pts) : { x: 0, y: 0 },

        };
      });
  }, [overlays, pageSize.width, pageSize.height, defaultColor]);



  const fontPx = LABEL_FONT_PX * exportScale;
  const padX = LABEL_PAD_X * exportScale;
  const labelH = LABEL_H * exportScale;
  const gap = LABEL_GAP * exportScale;
  // Bold sans-serif at 13px averages ~0.82em per character (wider for
  // labels containing `@`, `M`, `W`, `U`, digits). The optimizer must
  // reserve enough width so labels don't visually crowd/clip each other.
  const charPx = fontPx * 0.82;

  // Layout keys omit hover/drag state so the placement worker doesn't
  // recompute (and reshuffle labels) on every hover or pan.
  const circleLayoutKey = useMemo(
    () =>
      circles
        .map((c) => `${c.id}:${Math.round(c.cx)}:${Math.round(c.cy)}:${Math.round(c.r)}:${c.label ?? ""}`)
        .join("|"),
    [circles],
  );
  const rectLayoutKey = useMemo(
    () =>
      rects
        .map((r) => `${r.id}:${Math.round(r.x)}:${Math.round(r.y)}:${Math.round(r.w)}:${Math.round(r.h)}:${Math.round(r.labelAnchor?.x ?? 0)}:${Math.round(r.labelAnchor?.y ?? 0)}:${r.label ?? ""}`)
        .join("|"),
    [rects],
  );

  // Build a stable input snapshot for the placement pass. Referenced by both
  // the sync (export) branch and the async worker branch below.
  // Rect labels are docked to their box's top-left corner (rendered inside
  // RectOverlay) and are intentionally excluded from the placement
  // optimizer — they have a fixed anchor and don't compete with circles
  // for space.
  // Rect labels are docked to their box's top-left corner (not moved by the
  // optimizer), but circle labels should still avoid obscuring them. Include
  // each rect as an obstacle plus a synthetic obstacle sized to its docked
  // label (measured at MAX font so the reservation is stable across zoom).
  const rectObstacles: {
    id: string; x: number; y: number; w: number; h: number; color: string; label?: string;
  }[] = [];
  // Bbox interiors are *soft* obstacles for the cluster strategy — they often
  // span the whole sheet, so treating them as hard would hide every label.
  const softRectIds: string[] = [];
  for (const r of rects) {
    rectObstacles.push({ id: r.id, x: r.x, y: r.y, w: r.w, h: r.h, color: r.color });
    softRectIds.push(r.id);
    if (r.label) {
      const measuredW = measureLabelWidthPx(r.label, fontPx);
      const w = (measuredW ?? r.label.length * charPx) + padX * 2 + 4;
      rectObstacles.push({
        id: `${r.id}__label`,
        x: r.x + (r.labelAnchor?.x ?? 0),
        y: r.y + (r.labelAnchor?.y ?? 0),

        w,
        h: labelH,
        color: r.color,
      });
    }
  }

  // ---- Local density LOD ---------------------------------------------------
  // Quantized, settle-debounced zoom so a smooth pinch/scroll doesn't retrigger
  // placement mid-gesture. Rendering still uses the live `viewScale`.
  const lodScale = useMemo(() => {
    const s = Math.max(0.0001, placementScale ?? viewScale);
    return Math.max(LOD_SCALE_QUANTIZE, Math.round(s / LOD_SCALE_QUANTIZE) * LOD_SCALE_QUANTIZE);
  }, [placementScale, viewScale]);

  /**
   * Local screen-space density pass. Runs over the whole page (not just the
   * viewport) so the low-detail set doesn't change while panning, and keys off
   * the settle-debounced `lodScale` so it only changes once a zoom gesture
   * finishes. Export/sync placement is unaffected.
   */
  const lowDetailIds = useMemo(() => {
    const out = new Set<string>();
    if (syncPlacement || exportScale > 1) return out;
    const targets = circles.filter((c) => !!c.label && !c.isDot);
    if (targets.length <= LOD_MAX_NEIGHBORS) return out;
    // Neighbor radius expressed in page units at the current zoom.
    const radius = LOD_NEIGHBOR_RADIUS_PX / Math.max(0.1, lodScale);
    const r2 = radius * radius;
    // Uniform grid bucketing so the neighbor scan stays near-linear.
    const cell = Math.max(1, radius);
    const buckets = new Map<string, typeof targets>();
    const keyOf = (x: number, y: number) => `${Math.floor(x / cell)}:${Math.floor(y / cell)}`;
    for (const c of targets) {
      const k = keyOf(c.cx, c.cy);
      const arr = buckets.get(k);
      if (arr) arr.push(c);
      else buckets.set(k, [c]);
    }
    for (const c of targets) {
      const gx = Math.floor(c.cx / cell);
      const gy = Math.floor(c.cy / cell);
      let count = 0;
      for (let dx = -1; dx <= 1 && count <= LOD_MAX_NEIGHBORS; dx++) {
        for (let dy = -1; dy <= 1 && count <= LOD_MAX_NEIGHBORS; dy++) {
          const arr = buckets.get(`${gx + dx}:${gy + dy}`);
          if (!arr) continue;
          for (const o of arr) {
            if (o.id === c.id) continue;
            const ddx = o.cx - c.cx;
            const ddy = o.cy - c.cy;
            if (ddx * ddx + ddy * ddy <= r2) {
              count++;
              if (count > LOD_MAX_NEIGHBORS) break;
            }
          }
        }
      }
      if (count > LOD_MAX_NEIGHBORS) out.add(c.id);
    }
    return out;
  }, [circles, lodScale, syncPlacement, exportScale]);

  const lowDetailKey = useMemo(
    () => `${lowDetailIds.size}:${Array.from(lowDetailIds).sort().join(",")}`,
    [lowDetailIds],
  );


  /**
   * Ids whose label the placement engine could not fit anywhere without a
   * collision. They render as anchor dots only (drawn fully opaque).
   */
  const [suppressedIds, setSuppressedIds] = useState<Set<string>>(new Set());

  // ---- Viewport culling for the placement pass -----------------------------
  // Only annotations/obstacles near the visible region participate in
  // placement, so labels never dodge geometry the user can't see. The export
  // (sync) path always places the whole page.
  const visibleBounds = useMemo(() => {
    if (syncPlacement || exportScale > 1) return null;
    if (!viewportRect) return null;
    const { nx, ny, nw, nh } = viewportRect;
    if (!(nw > 0) || !(nh > 0)) return null;
    const x1 = Math.max(0, nx * pageSize.width);
    const y1 = Math.max(0, ny * pageSize.height);
    const x2 = Math.min(pageSize.width, (nx + nw) * pageSize.width);
    const y2 = Math.min(pageSize.height, (ny + nh) * pageSize.height);
    if (x2 <= x1 || y2 <= y1) return null;
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    syncPlacement,
    exportScale,
    pageSize.width,
    pageSize.height,
    viewportRect ? Math.round(viewportRect.nx * 1000) : -1,
    viewportRect ? Math.round(viewportRect.ny * 1000) : -1,
    viewportRect ? Math.round(viewportRect.nw * 1000) : -1,
    viewportRect ? Math.round(viewportRect.nh * 1000) : -1,
  ]);

  const cullRect = useMemo(() => {
    if (!visibleBounds) return null;
    const bx = visibleBounds.width * VIEWPORT_BUFFER_RATIO;
    const by = visibleBounds.height * VIEWPORT_BUFFER_RATIO;
    return {
      x1: Math.max(0, visibleBounds.x - bx),
      y1: Math.max(0, visibleBounds.y - by),
      x2: Math.min(pageSize.width, visibleBounds.x + visibleBounds.width + bx),
      y2: Math.min(pageSize.height, visibleBounds.y + visibleBounds.height + by),
    };
  }, [visibleBounds, pageSize.width, pageSize.height]);

  const cullKey = cullRect
    ? `${Math.round(cullRect.x1)}:${Math.round(cullRect.y1)}:${Math.round(cullRect.x2)}:${Math.round(cullRect.y2)}`
    : "none";

  const intersectsCull = (x1: number, y1: number, x2: number, y2: number) =>
    !cullRect ||
    (x2 >= cullRect.x1 && x1 <= cullRect.x2 && y2 >= cullRect.y1 && y1 <= cullRect.y2);

  const intersectsVisible = (x1: number, y1: number, x2: number, y2: number) =>
    !visibleBounds ||
    (x2 >= visibleBounds.x &&
      x1 <= visibleBounds.x + visibleBounds.width &&
      y2 >= visibleBounds.y &&
      y1 <= visibleBounds.y + visibleBounds.height);

  // The viewer renders pills at a constant on-screen size, so their page-unit
  // footprint shrinks as you zoom in. Reserve exactly what will be drawn,
  // otherwise at high zoom the engine reserves several times the real area and
  // fabricates collisions. Export/sync keeps the full-size reservation.
  const placementSizing = useMemo(() => {
    if (syncPlacement) {
      return { fontPx, padX, labelH, charPx };
    }
    const s = Math.max(0.1, lodScale);
    const sizing = labelSizingForZoom(lodScale);
    const pFont = (sizing.font / s) * exportScale;
    return {
      fontPx: pFont,
      padX: (sizing.padX / s) * exportScale,
      labelH: ((sizing.font * 1.35 + sizing.padY * 2) / s) * exportScale,
      charPx: pFont * 0.82,
    };
  }, [syncPlacement, fontPx, padX, labelH, charPx, lodScale, exportScale]);

  const placementSizingKey = `${placementSizing.fontPx.toFixed(3)}:${placementSizing.labelH.toFixed(3)}`;

  const buildPlacementInput = (opts?: {
    placementTargetIds?: string[];
    fixedLabels?: PlacedLabel[];
    previousLabels?: PlacedLabel[];
  }) => ({
    pageSize,
    bounds: visibleBounds ?? undefined,
    circles: circles
      .filter((c) => intersectsCull(c.cx - c.r, c.cy - c.r, c.cx + c.r, c.cy + c.r))
      .map((c) => ({
        id: c.id, cx: c.cx, cy: c.cy, r: c.r, color: c.color,
        label: c.label, isDot: c.isDot,
        measuredWidthPx:
          c.label && !c.isDot
            ? measureLabelWidthPx(c.label, placementSizing.fontPx)
            : undefined,
      })),
    rects: rectObstacles.filter((r) =>
      intersectsCull(r.x, r.y, r.x + r.w, r.y + r.h),
    ),
    fontPx: placementSizing.fontPx,
    padX: placementSizing.padX,
    labelH: placementSizing.labelH,
    gap,
    charPx: placementSizing.charPx,
    scale: exportScale,
    placementTargetIds: opts?.placementTargetIds,
    fixedLabels: opts?.fixedLabels?.map(({ x, y, w, h }) => ({ x, y, w, h })),
    leaderSoftCap: syncPlacement
      ? undefined
      : LEADER_SOFT_CAP_SCREEN_PX / Math.max(0.1, lodScale),
    minLeader: syncPlacement
      ? undefined
      : MIN_LEADER_SCREEN_PX / Math.max(0.1, lodScale),
    strategy: (syncPlacement ? "legacy" : "cluster") as "legacy" | "cluster",
    clusterProximity: CLUSTER_PROXIMITY_PX / Math.max(0.1, lodScale),
    previousLabels: opts?.previousLabels?.map(({ id, x, y, w, h }) => ({ id, x, y, w, h })),
    softRectIds: syncPlacement ? undefined : softRectIds,
  });


  // Synchronous branch — used by offscreen export capture, which rasterizes
  // on the next animation frame and can't wait for a worker roundtrip.
  const syncPlaced = useMemo(
    () => (syncPlacement ? runPlacement(buildPlacementInput()) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [syncPlacement, circleLayoutKey, rectLayoutKey, pageSize.width, pageSize.height, fontPx, padX, labelH, gap, charPx],
  );

  // Async branch — pushes the heavy optimizer pass into a Web Worker so
  // opening a viewer with many annotations doesn't block paint or input.
  const [asyncPlaced, setAsyncPlaced] = useState<PlacedLabel[]>([]);
  /**
   * Cached label positions. Entries remember the label height they were placed
   * with so a zoom change can rescale them in place (zoom hysteresis) instead
   * of invalidating the whole layout.
   */
  const placementCacheRef = useRef<Map<string, { p: PlacedLabel; labelH: number }>>(new Map());
  // NOTE: zoom (lodScale / sizing) is deliberately NOT part of this key —
  // zooming must not wipe cached positions. Only real structural changes
  // (annotation set / geometry / page size) reset the cache.
  const placementStructureKey = `${circleLayoutKey}::${rectLayoutKey}::${pageSize.width}x${pageSize.height}`;
  const lastPlacementStructureKeyRef = useRef(placementStructureKey);
  useEffect(() => {
    if (syncPlacement) return;
    if (lastPlacementStructureKeyRef.current !== placementStructureKey) {
      placementCacheRef.current.clear();
      lastPlacementStructureKeyRef.current = placementStructureKey;
    }
    const targetIds = circles
      .filter((c) =>
        !!c.label &&
        !c.isDot &&
        !lowDetailIds.has(c.id) &&
        intersectsVisible(c.cx, c.cy, c.cx, c.cy),
      )
      .map((c) => c.id);
    const targetIdSet = new Set(targetIds);
    const fitsVisibleBounds = (p: PlacedLabel) =>
      !visibleBounds ||
      (p.x >= visibleBounds.x &&
        p.y >= visibleBounds.y &&
        p.x + p.w <= visibleBounds.x + visibleBounds.width &&
        p.y + p.h <= visibleBounds.y + visibleBounds.height);
    const overlaps = (
      a: { x: number; y: number; w: number; h: number },
      b: { x: number; y: number; w: number; h: number },
    ) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

    // Zoom hysteresis: rescale each cached label around its own center to the
    // footprint it would have at the current zoom, then keep it unless it is
    // now clipped by the viewport or collides with another retained label /
    // docked rect label. Only invalid labels are re-placed.
    const cache = placementCacheRef.current;
    const hardObstacles = rectObstacles.filter((r) => r.id.endsWith("__label"));
    const retained: PlacedLabel[] = [];
    for (const entry of Array.from(cache.values())) {
      if (!targetIdSet.has(entry.p.id)) {
        cache.delete(entry.p.id);
        continue;
      }
      const k = entry.labelH > 0 ? placementSizing.labelH / entry.labelH : 1;
      const cx = entry.p.x + entry.p.w / 2;
      const cy = entry.p.y + entry.p.h / 2;
      const w = entry.p.w * k;
      const h = entry.p.h * k;
      const next: PlacedLabel = { ...entry.p, x: cx - w / 2, y: cy - h / 2, w, h };
      const valid =
        fitsVisibleBounds(next) &&
        !retained.some((r) => overlaps(next, r)) &&
        !hardObstacles.some((r) => overlaps(next, r));
      if (valid) {
        cache.set(next.id, { p: next, labelH: placementSizing.labelH });
        retained.push(next);
      } else {
        cache.delete(entry.p.id);
      }
    }
    setAsyncPlaced(retained);
    const retainedIds = new Set(retained.map((p) => p.id));
    const missingIds = targetIds.filter((id) => !retainedIds.has(id));
    const hasLabels = showLabels && targetIds.length > 0;
    if (!hasLabels) {
      setAsyncPlaced([]);
      setSuppressedIds(new Set());
      onPlacingChangeRef.current?.(false);
      return;
    }
    if (missingIds.length === 0) {
      onPlacingChangeRef.current?.(false);
      return;
    }
    onPlacingChangeRef.current?.(true);
    const ticket = requestPlacement(
      buildPlacementInput({
        placementTargetIds: missingIds,
        fixedLabels: retained,
        previousLabels: retained,
      }),
      ({ placed, suppressedIds: suppressed }) => {
        for (const p of placed) cache.set(p.id, { p, labelH: placementSizing.labelH });
        for (const id of suppressed) cache.delete(id);
        setAsyncPlaced([...retained, ...placed]);
        setSuppressedIds(new Set(suppressed));
        onPlacingChangeRef.current?.(false);
      },
      (err) => {
        // eslint-disable-next-line no-console
        console.warn("[OverlayLayer] placement failed", err);
        onPlacingChangeRef.current?.(false);
      },
    );
    return () => ticket.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncPlacement, showLabels, placementStructureKey, cullKey, lowDetailKey, pageSize.width, pageSize.height, fontPx, padX, labelH, gap, charPx, placementSizingKey]);


  // On unmount, ensure the parent's "placing" flag doesn't stay stuck on.
  useEffect(() => {
    return () => {
      onPlacingChangeRef.current?.(false);
    };
  }, []);

  const placedLabels: PlacedLabel[] = !showLabels
    ? []
    : syncPlacement
      ? (syncPlaced ?? [])
      : asyncPlaced;

  /**
   * Hover driven from inside the overlay layer (anchor dot or label pill).
   * Merged with the `hoveredId` prop (driven by the side list) so both sources
   * highlight the same pair.
   */
  const [localHoverId, setLocalHoverId] = useState<string | null>(null);
  const effectiveHoverId = localHoverId ?? hoveredId ?? null;

  /**
   * A hovered / selected annotation whose label was suppressed (or dropped by
   * the density LOD) still deserves its label. It's rendered as a simple pill
   * docked to the anchor (outside the optimizer, so hovering never retriggers
   * a placement pass).
   */
  const focusFallbackCircle = useMemo(() => {
    if (!showLabels) return null;
    const focusId = effectiveHoverId || selectedId;
    if (!focusId) return null;
    if (!suppressedIds.has(focusId) && !lowDetailIds.has(focusId)) return null;
    if (placedLabels.some((p) => p.id === focusId)) return null;
    return circles.find((c) => c.id === focusId && !!c.label) ?? null;
  }, [showLabels, effectiveHoverId, selectedId, suppressedIds, lowDetailIds, placedLabels, circles]);


  // After labels render, measure their actual bounding boxes and snap every
  // leader line endpoint flush to the visible label edge. This guarantees
  // perfect alignment even when font metrics or zoom interpolation change the
  // rendered size, which is especially important on the tight 20px ring.
  useLayoutEffect(() => {
    const root = overlayRootRef.current;
    if (!root) return;
    const rootRect = root.getBoundingClientRect();
    const s = Math.max(0.0001, viewScale);
    const circleMap = new Map(circles.map((c) => [c.id, c]));

    placedLabels.forEach((p) => {
      if (p.kind !== "circle") return;
      const labelEl = labelRefMap.current.get(p.id);
      const lineEl = leaderRefMap.current.get(p.id);
      const c = circleMap.get(p.id);
      if (!labelEl || !lineEl || !c) return;

      const labelRect = labelEl.getBoundingClientRect();
      const labelX = (labelRect.left - rootRect.left) / s;
      const labelY = (labelRect.top - rootRect.top) / s;
      const labelW = labelRect.width / s;
      const labelH = labelRect.height / s;
      const labelCx = labelX + labelW / 2;
      const labelCy = labelY + labelH / 2;

      const ax = c.cx;
      const ay = c.cy;
      const dx = labelCx - ax;
      const dy = labelCy - ay;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;

      const x1 = ax + ux * c.r;
      const y1 = ay + uy * c.r;

      const halfW = labelW / 2;
      const halfH = labelH / 2;
      const tX = Math.abs(ux) > 1e-6 ? halfW / Math.abs(ux) : Infinity;
      const tY = Math.abs(uy) > 1e-6 ? halfH / Math.abs(uy) : Infinity;
      const tEdge = Math.min(tX, tY);
      const x2 = labelCx - ux * tEdge;
      const y2 = labelCy - uy * tEdge;

      const leaderLen = Math.hypot(x2 - x1, y2 - y1);
      if (leaderLen < 0.5) {
        lineEl.setAttribute("display", "none");
      } else {
        lineEl.setAttribute("display", "block");
        lineEl.setAttribute("x1", String(x1));
        lineEl.setAttribute("y1", String(y1));
        lineEl.setAttribute("x2", String(x2));
        lineEl.setAttribute("y2", String(y2));
      }
    });
  }, [placedLabels, circles, viewScale]);



  return (
    <div
      ref={overlayRootRef}
      data-overlay-root
      className="pointer-events-none absolute inset-0"
      style={{ width: pageSize.width, height: pageSize.height }}
    >
      {/* Leader lines (SVG, behind circles). Rect labels get no leader. */}
      <svg
        className="absolute inset-0 pointer-events-none"
        width={pageSize.width}
        height={pageSize.height}
        style={{ overflow: "visible" }}
      >
        {placedLabels.filter((p) => p.kind === "circle").map((p, idx) => {
          const s = Math.max(0.0001, viewScale);
          // The rendered label uses zoom-interpolated font/padding, so its
          // actual on-screen footprint is smaller than the optimizer's
          // reservation (which uses the MAX font). Recompute the true
          // on-screen size here so the leader terminates flush against the
          // visible label edge with no gap.
          const sizing = labelSizingForZoom(viewScale);
          const lines = p.text.split("\n");
          const longest = lines.reduce((m, ln) => Math.max(m, ln.length), 0);
          const renderWScreen =
            longest * sizing.font * 0.82 + sizing.padX * 2 + 4;
          const renderHScreen = lines.length * sizing.font * 1.25 + 1 * 2;
          const labelWPage = (renderWScreen * exportScale) / s;
          const labelHPage = (renderHScreen * exportScale) / s;
          const labelCx = p.x + p.w / 2; // anchor stays at the reservation's center
          const labelCy = p.y + p.h / 2;
          const c = circles.find((c) => c.id === p.id);
          if (!c) return null;
          const ax = c.cx;
          const ay = c.cy;
          const dx = labelCx - ax;
          const dy = labelCy - ay;
          const len = Math.hypot(dx, dy) || 1;
          const ux = dx / len;
          const uy = dy / len;
          // Start the leader on the circle's edge (radius offset toward label).
          const x1 = ax + ux * c.r;
          const y1 = ay + uy * c.r;
          // Terminate at the actual on-screen label rect edge.
          const halfW = labelWPage / 2;
          const halfH = labelHPage / 2;
          const tX = Math.abs(ux) > 1e-6 ? halfW / Math.abs(ux) : Infinity;
          const tY = Math.abs(uy) > 1e-6 ? halfH / Math.abs(uy) : Infinity;
          const tEdge = Math.min(tX, tY);
          const x2 = labelCx - ux * tEdge;
          const y2 = labelCy - uy * tEdge;
          const leaderLen = Math.hypot(x2 - x1, y2 - y1);
          if (leaderLen < 0.5) return null;
          const isHovered = effectiveHoverId === p.id;
          const leaderStroke =
            ((LEADER_STROKE_PX_SCREEN + (isHovered ? 1 : 0)) * exportScale) /
            Math.max(0.0001, viewScale);
          const leaderOpacity = isHovered ? 1 : LABEL_OPACITY;
          return (
            <line
              ref={(el) => { if (el) leaderRefMap.current.set(p.id, el); }}
              key={`leader-${p.id}-${idx}`}
              data-export-kind="leader"
              data-color={p.color}
              data-opacity={LABEL_OPACITY}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={p.color}
              strokeWidth={leaderStroke}
              vectorEffect="non-scaling-stroke"
              style={{
                vectorEffect: "non-scaling-stroke",
                strokeWidth: leaderStroke,
              }}
              opacity={leaderOpacity}
            />
          );
        })}
      </svg>

      {circles.map((c) => {
        const isDragging = drag?.id === c.id;
        return (
          <CircleOverlay
            key={c.id}
            c={c}
            hovered={hoveredId === c.id}
            selected={selectedId === c.id}
            pulsing={pulsingId === c.id}
            exportScale={exportScale}
            clickable={!!onOverlayClick}
            draggable={!!onOverlayDrag}
            isDragging={isDragging}
            dragDx={isDragging ? drag!.dx : 0}
            dragDy={isDragging ? drag!.dy : 0}
            viewScale={viewScale}
            pageWidth={pageSize.width}
            pageHeight={pageSize.height}
            dragRef={dragRef}
            setDrag={setDrag}
            onOverlayClick={onOverlayClick}
            onOverlayDrag={onOverlayDrag}
            denseOpaque={showLabels && suppressedIds.has(c.id)}
          />
        );
      })}


      {/* Rectangle overlays. Border + docked top-left label render inside
          RectOverlay; both stay at constant on-screen size by dividing by
          the current viewport zoom scale. */}
      {rects.map((r) => (
        <RectOverlay
          key={r.id}
          r={r}
          hovered={hoveredId === r.id}
          exportScale={exportScale}
          viewScale={viewScale}
          fullSizeLabels={fullSizeLabels}
        />
      ))}



      {/* Labels (above circles & rects). Positions chosen by the optimizer.
          Rendered at constant on-screen size by dividing font/padding by
          the current viewport zoom scale; anchored at the center of the
          optimizer's chosen rect so labels stay put across zoom levels.
          In `fullSizeLabels` (export) mode the pill is rendered at the
          optimizer's reserved font/padding/height instead, so the exported
          raster matches the reserved footprint exactly. */}
      {placedLabels.map((p) => {
        const s = Math.max(0.0001, viewScale);
        const sizing = labelSizingForZoom(viewScale);
        const renderFont = fullSizeLabels ? fontPx : (sizing.font / s) * exportScale;
        const renderPadX = fullSizeLabels ? padX : (sizing.padX / s) * exportScale;
        const renderPadY = fullSizeLabels ? 0 : (1 / s) * exportScale;
        const lineHeightPx = Math.round(renderFont * 1.25);
        const centerX = p.x + p.w / 2;
        const centerY = p.y + p.h / 2;
        return (
          <div
            ref={(el) => { if (el) labelRefMap.current.set(p.id, el); }}
            key={`label-${p.id}`}
            data-export-kind="label"
            data-color={p.color}
            data-text-color={readableTextOn(p.color)}
            data-x={p.x}
            data-y={p.y}
            data-w={p.w}
            data-h={p.h}
            data-font-px={renderFont}
            data-opacity={LABEL_OPACITY}
            className="absolute font-bold pointer-events-none text-center"
            style={{
              left: centerX,
              top: centerY,
              transform: "translate(-50%, -50%)",
              lineHeight: `${lineHeightPx}px`,
              fontSize: renderFont,
              paddingLeft: renderPadX,
              paddingRight: renderPadX,
              paddingTop: renderPadY,
              paddingBottom: renderPadY,
              ...(fullSizeLabels
                ? {
                    height: p.h,
                    display: "flex",
                    flexDirection: "column" as const,
                    alignItems: "center" as const,
                    justifyContent: "center" as const,
                  }
                : null),
              boxSizing: "border-box",
              borderRadius: 0,
              backgroundColor: p.color,
              color: readableTextOn(p.color),
              opacity: LABEL_OPACITY,
              whiteSpace: "pre",
            }}
          >
            {p.text}
          </div>
        );
      })}

      {/* LOD fallback: hovered / selected annotation in a dense cluster keeps
          its label, docked just outside the anchor dot. */}
      {focusFallbackCircle ? (() => {
        const c = focusFallbackCircle;
        const s = Math.max(0.0001, viewScale);
        const sizing = labelSizingForZoom(viewScale);
        return (
          <div
            key={`label-focus-${c.id}`}
            className="absolute font-bold pointer-events-none text-center"
            style={{
              left: c.cx + c.r + 4 / s,
              top: c.cy,
              transform: "translate(0, -50%)",
              lineHeight: `${Math.round((sizing.font / s) * 1.25)}px`,
              fontSize: sizing.font / s,
              paddingLeft: sizing.padX / s,
              paddingRight: sizing.padX / s,
              paddingTop: 1 / s,
              paddingBottom: 1 / s,
              boxSizing: "border-box",
              backgroundColor: c.color,
              color: readableTextOn(c.color),
              opacity: LABEL_OPACITY,
              whiteSpace: "pre",
            }}
          >
            {c.label}
          </div>
        );
      })() : null}



    </div>
  );
};
