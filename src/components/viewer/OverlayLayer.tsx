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
   * Fired whenever the async placement pass starts (true) or finishes
   * (false). Consumers can use this to render a loading affordance on
   * side panels that let the user mutate annotations.
   */
  onPlacingChange?: (isPlacing: boolean) => void;
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
const CIRCLE_BORDER_PX_SCREEN = 2;
const LEADER_STROKE_PX_SCREEN = 1.25;

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




// ---- Memoized child components --------------------------------------------
//
// Extracted so React can skip reconciling unchanged annotations when the
// hovered id changes. Only the previously-hovered and newly-hovered items
// re-render; the rest are bailed out by `React.memo`'s shallow-equal check.

interface RectOverlayProps {
  r: { id: string; x: number; y: number; w: number; h: number; color: string; label?: string };
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
}
const RectOverlay = memo(function RectOverlay({ r, hovered, exportScale, viewScale }: RectOverlayProps) {
  const s = Math.max(0.0001, viewScale);
  const borderPxScreen = (hovered ? 3 : 2) * exportScale;
  const borderPxPage = borderPxScreen / s;
  // Label docks to the top-left corner of the box like a header tab. It
  // shares the box's top-left origin so it visually "sits on" the border.
  const label = r.label ?? "";
  const sizing = labelSizingForZoom(viewScale);
  const fontCss = (sizing.font / s) * exportScale;
  const padXCss = (sizing.padX / s) * exportScale;
  const padYCss = (sizing.padY / s) * exportScale;
  const labelHCss = fontCss * 1.35 + padYCss * 2;
  const textColor = readableTextOn(r.color);
  return (
    <div style={{ position: "absolute", left: r.x, top: r.y, pointerEvents: "none" }}>
      {/* SVG border with non-scaling-stroke keeps the stroke a constant
          number of device pixels regardless of ancestor CSS transforms. */}
      <svg
        width={r.w}
        height={r.h}
        style={{ position: "absolute", left: 0, top: 0, overflow: "visible", pointerEvents: "none" }}
      >
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
          vectorEffect="non-scaling-stroke"
          style={{ vectorEffect: "non-scaling-stroke", strokeWidth: borderPxPage }}
        />
      </svg>
      {label ? (
        <div
          data-export-kind="label"
          data-color={r.color}
          data-text-color={textColor}
          data-x={r.x}
          data-y={r.y}
          data-font-px={fontCss}
          data-opacity={1}
          className="absolute font-bold pointer-events-none"
          style={{
            left: 0,
            top: 0,
            maxWidth: r.w,
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
            overflow: "hidden",
            textOverflow: "ellipsis",
            borderTopLeftRadius: 0,
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
}
const CircleOverlay = memo(function CircleOverlay(props: CircleOverlayProps) {
  const {
    c, hovered, exportScale, clickable, draggable, isDragging, dragDx, dragDy,
    viewScale, pageWidth, pageHeight, dragRef, setDrag, onOverlayClick, onOverlayDrag,
  } = props;

  const dotBaseAlpha = draggable ? 0.5 : (hovered ? 0.85 : 0.7);
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
        backgroundColor: withAlpha(c.color, hovered ? 0.35 : 0.2),
        boxSizing: "border-box",
        pointerEvents: clickable || draggable ? "auto" : "none",
        cursor: draggable ? (isDragging ? "grabbing" : "grab") : clickable ? "pointer" : undefined,
        touchAction: draggable ? "none" : undefined,
      };

  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  const DRAG_THRESHOLD = 4;

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
    const moved = cur.moved || Math.hypot(rawDx, rawDy) > DRAG_THRESHOLD;
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

  const strokePxScreen = (hovered ? 3 : CIRCLE_BORDER_PX_SCREEN) * exportScale;
  const strokePxPage = strokePxScreen / Math.max(0.0001, viewScale);

  return (
    <div
      data-export-kind="circle"
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
  viewScale = 1,
  defaultColor = "hsl(var(--destructive))",
  onOverlayClick,
  onOverlayDrag,
  exportScale = 1,
  syncPlacement = false,
  onPlacingChange,
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
        const diameter = baseDiameter * exportScale;

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
      .map((o) => ({
        id: o.id,
        x: o.rect.px?.x ?? o.rect.nx * pageSize.width,
        y: o.rect.px?.y ?? o.rect.ny * pageSize.height,
        w: Math.max(1, o.rect.px?.w ?? o.rect.nw * pageSize.width),
        h: Math.max(1, o.rect.px?.h ?? o.rect.nh * pageSize.height),
        color: o.color ?? defaultColor,
        label: o.label,
      }));
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
        .map((r) => `${r.id}:${Math.round(r.x)}:${Math.round(r.y)}:${Math.round(r.w)}:${Math.round(r.h)}:${r.label ?? ""}`)
        .join("|"),
    [rects],
  );

  // Build a stable input snapshot for the placement pass. Referenced by both
  // the sync (export) branch and the async worker branch below.
  // Rect labels are docked to their box's top-left corner (rendered inside
  // RectOverlay) and are intentionally excluded from the placement
  // optimizer — they have a fixed anchor and don't compete with circles
  // for space.
  const buildPlacementInput = () => ({
    pageSize,
    circles: circles.map((c) => ({
      id: c.id, cx: c.cx, cy: c.cy, r: c.r, color: c.color,
      label: c.label, isDot: c.isDot,
    })),
    rects: [],
    fontPx, padX, labelH, gap, charPx,
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
  useEffect(() => {
    if (syncPlacement) return;
    const hasLabels = circles.some((c) => !!c.label && !c.isDot);
    if (!hasLabels) {
      setAsyncPlaced([]);
      onPlacingChangeRef.current?.(false);
      return;
    }
    onPlacingChangeRef.current?.(true);
    const ticket = requestPlacement(
      buildPlacementInput(),
      (placed) => {
        setAsyncPlaced(placed);
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
  }, [syncPlacement, circleLayoutKey, rectLayoutKey, pageSize.width, pageSize.height, fontPx, padX, labelH, gap, charPx]);


  // On unmount, ensure the parent's "placing" flag doesn't stay stuck on.
  useEffect(() => {
    return () => {
      onPlacingChangeRef.current?.(false);
    };
  }, []);

  const placedLabels: PlacedLabel[] = syncPlacement ? (syncPlaced ?? []) : asyncPlaced;

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
          const renderHScreen = lines.length * sizing.font * 1.25 + sizing.padY * 2;
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
              strokeWidth={(LEADER_STROKE_PX_SCREEN * exportScale) / Math.max(0.0001, viewScale)}
              vectorEffect="non-scaling-stroke"
              style={{
                vectorEffect: "non-scaling-stroke",
                strokeWidth: (LEADER_STROKE_PX_SCREEN * exportScale) / Math.max(0.0001, viewScale),
              }}
              opacity={LABEL_OPACITY}
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
        />
      ))}



      {/* Labels (above circles & rects). Positions chosen by the optimizer.
          Rendered at constant on-screen size by dividing font/padding by
          the current viewport zoom scale; anchored at the center of the
          optimizer's chosen rect so labels stay put across zoom levels. */}
      {placedLabels.map((p) => {
        const s = Math.max(0.0001, viewScale);
        const sizing = labelSizingForZoom(viewScale);
        const renderFont = (sizing.font / s) * exportScale;
        const renderPadX = (sizing.padX / s) * exportScale;
        const renderPadY = (sizing.padY / s) * exportScale;
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
            data-font-px={fontPx}
            data-opacity={LABEL_OPACITY}
            className="absolute font-bold pointer-events-none text-center"
            style={{
              left: centerX,
              top: centerY,
              transform: "translate(-50%, -50%)",
              lineHeight: `${Math.round(renderFont * 1.25)}px`,
              fontSize: renderFont,
              paddingLeft: renderPadX,
              paddingRight: renderPadX,
              paddingTop: renderPadY,
              paddingBottom: renderPadY,
              boxSizing: "border-box",
              borderRadius: (3 / s) * exportScale,
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

    </div>
  );
};
