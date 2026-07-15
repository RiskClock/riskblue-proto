import { CSSProperties, PointerEvent as ReactPointerEvent, memo, useEffect, useMemo, useRef, useState } from "react";
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

// Label sizing in unscaled page CSS px. These scale naturally with the page
// transform, so markers/labels grow when zooming in and shrink when zooming out.
// Layout sizing used by the placement optimizer (in unscaled page CSS px).
// Rendered labels use a constant ON-SCREEN size (see LABEL_FONT_PX_SCREEN
// below) by dividing by the current viewport zoom scale.
const LABEL_FONT_PX = 10;
const LABEL_PAD_X = 4;
const LABEL_H = 15;
const LABEL_GAP = 0;
const LABEL_OPACITY = 0.85;
// Target constant on-screen sizes (CSS px, independent of zoom).
const LABEL_FONT_PX_SCREEN = 10;
const LABEL_PAD_X_SCREEN = 4;
const CIRCLE_BORDER_PX_SCREEN = 2;
const LEADER_STROKE_PX_SCREEN = 1.25;

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
  const borderPxScreen = hovered ? 3 : 2;
  const borderCss = (borderPxScreen / s) * exportScale;
  // Label docks to the top-left corner of the box like a header tab. It
  // shares the box's top-left origin so it visually "sits on" the border.
  const label = r.label ?? "";
  const fontScreen = 10; // constant on-screen font size in CSS px
  const fontCss = (fontScreen / s) * exportScale;
  const padXCss = (4 / s) * exportScale;
  const padYCss = (2 / s) * exportScale;
  const labelHCss = fontCss * 1.35 + padYCss * 2;
  const textColor = readableTextOn(r.color);
  return (
    <div style={{ position: "absolute", left: r.x, top: r.y, pointerEvents: "none" }}>
      <div
        data-export-kind="rect"
        data-color={r.color}
        data-border-px={borderPxScreen}
        style={{
          width: r.w,
          height: r.h,
          borderColor: withAlpha(r.color, 0.5),
          borderWidth: borderCss,
          borderStyle: "solid",
          backgroundColor: "transparent",
          boxSizing: "border-box",
          pointerEvents: "none",
        }}
      />
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
        borderRadius: "9999px",
        borderColor: withAlpha(c.color, 0.5),
        borderWidth: ((hovered ? 3 : CIRCLE_BORDER_PX_SCREEN) / Math.max(0.0001, viewScale)) * exportScale,
        borderStyle: "solid",
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
    />
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
          : Math.max(MIN_CIRCLE_DIAMETER_CSS, bboxSidePx * 1.5) * 0.39;
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
  // Slightly generous per-character width so clamped labels near the page
  // edge don't visually spill past their computed rect.
  const charPx = fontPx * 0.72;

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



  return (
    <div
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
          const labelCx = p.x + p.w / 2;
          const labelCy = p.y + p.h / 2;
          // Always resolve anchor from the live circle by id — never trust
          // p.ax/p.ay if the corresponding circle has moved since the layout
          // was memoized, and never draw a leader to a phantom (0,0) anchor
          // if the circle is missing (skip instead).
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
          // Terminate the leader at the label rectangle's edge (not its
          // center), so a label sitting close to its circle still shows a
          // visible connector rather than a stub buried under the label.
          const halfW = p.w / 2;
          const halfH = p.h / 2;
          const tX = Math.abs(ux) > 1e-6 ? halfW / Math.abs(ux) : Infinity;
          const tY = Math.abs(uy) > 1e-6 ? halfH / Math.abs(uy) : Infinity;
          const tEdge = Math.min(tX, tY);
          const x2 = labelCx - ux * tEdge;
          const y2 = labelCy - uy * tEdge;
          const leaderLen = Math.hypot(x2 - x1, y2 - y1);
          if (leaderLen < 0.5) return null;
          if (import.meta.env.DEV) {
            const off =
              x1 < -2 || y1 < -2 || x1 > pageSize.width + 2 || y1 > pageSize.height + 2;
            if (off) {
              // eslint-disable-next-line no-console
              console.warn("[OverlayLayer] leader anchor off-page", {
                id: p.id,
                text: p.text,
                circle: { cx: c.cx, cy: c.cy, r: c.r },
                pAxAy: { ax: p.ax, ay: p.ay },
                pageSize,
                x1, y1, x2, y2,
              });
            }
          }
          return (
            <line
              key={`leader-${p.id}-${idx}`}
              data-export-kind="leader"
              data-color={p.color}
              data-opacity={LABEL_OPACITY}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={p.color}
              strokeWidth={(LEADER_STROKE_PX_SCREEN / Math.max(0.0001, viewScale)) * exportScale}
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



      {/* Labels (above circles & rects). Positions chosen by the optimizer. */}
      {placedLabels.map((p) => (
        <div
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
            left: p.x,
            top: p.y,
            width: p.w,
            height: p.h,
            lineHeight: `${Math.round(fontPx * 1.25)}px`,
            fontSize: fontPx,
            paddingLeft: padX,
            paddingRight: padX,
            paddingTop: Math.max(0, (p.h - Math.round(fontPx * 1.25) * p.text.split("\n").length) / 2),
            boxSizing: "border-box",
            borderRadius: 3,
            backgroundColor: p.color,
            color: readableTextOn(p.color),
            opacity: LABEL_OPACITY,
            whiteSpace: "pre",
          }}
        >
          {p.text}
        </div>
      ))}

    </div>
  );
};
