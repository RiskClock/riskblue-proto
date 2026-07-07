import { CSSProperties, PointerEvent as ReactPointerEvent, useMemo, useRef, useState } from "react";
import type { NormalizedOverlay } from "./viewerGeometry";
import { readableTextOn } from "@/lib/awpColor";

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
}

const MIN_CIRCLE_DIAMETER_CSS = 24;

// Label sizing in unscaled page CSS px. These scale naturally with the page
// transform, so markers/labels grow when zooming in and shrink when zooming out.
// Sizes are 30% smaller than the previous baseline (font 11 → 8, pad 6 → 4, h 18 → 13).
const LABEL_FONT_PX = 8;
const LABEL_PAD_X = 4;
const LABEL_H = 13;
const LABEL_GAP = 0;
const LABEL_OPACITY = 0.7;

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

interface LabelCandidate {
  x: number;
  y: number;
  w: number;
  h: number;
  ax: number; // anchor x on target edge (for leader — circles only)
  ay: number; // anchor y on target edge
  leader: number; // base leader length (0 for rects → no leader)
}

interface PlacedLabel extends LabelCandidate {
  id: string;
  color: string;
  text: string;
  kind: "circle" | "rect";
}

function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
  pad = 1,
): boolean {
  return !(
    a.x + a.w + pad <= b.x ||
    b.x + b.w + pad <= a.x ||
    a.y + a.h + pad <= b.y ||
    b.y + b.h + pad <= a.y
  );
}

function rectIntersectsCircle(
  rect: { x: number; y: number; w: number; h: number },
  c: { cx: number; cy: number; r: number },
): boolean {
  const closestX = Math.max(rect.x, Math.min(c.cx, rect.x + rect.w));
  const closestY = Math.max(rect.y, Math.min(c.cy, rect.y + rect.h));
  const dx = c.cx - closestX;
  const dy = c.cy - closestY;
  return dx * dx + dy * dy < c.r * c.r;
}

/**
 * Generate candidate label positions around a circle: 24 directions × 4 rings.
 */
function generateCircleCandidates(
  c: CircleInfo,
  labelW: number,
  labelH: number,
  gap: number,
  bounds: { width: number; height: number },
): LabelCandidate[] {
  const directions = 24;
  const rings = 4;
  const out: LabelCandidate[] = [];
  for (let ring = 0; ring < rings; ring++) {
    const dist = c.r + gap + ring * Math.max(6, labelH * 0.5);
    for (let i = 0; i < directions; i++) {
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / directions;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const labelCx = c.cx + cos * dist;
      const labelCy = c.cy + sin * dist;
      let lx = labelCx - labelW / 2;
      let ly = labelCy - labelH / 2;
      lx = Math.max(2, Math.min(bounds.width - labelW - 2, lx));
      ly = Math.max(2, Math.min(bounds.height - labelH - 2, ly));
      const ax = c.cx + cos * c.r;
      const ay = c.cy + sin * c.r;
      const ex = Math.max(lx, Math.min(c.cx, lx + labelW));
      const ey = Math.max(ly, Math.min(c.cy, ly + labelH));
      const leader = Math.hypot(ex - ax, ey - ay);
      out.push({ x: lx, y: ly, w: labelW, h: labelH, ax, ay, leader });
    }
  }
  return out;
}

/**
 * Generate candidate positions around a rectangle (floor-plan bbox).
 * Positions: outside each edge (above/below/left/right) at 3 alignments
 * (start / center / end), plus 3 gap rings. No leader is drawn for rects.
 */
function generateRectCandidates(
  r: { x: number; y: number; w: number; h: number },
  labelW: number,
  labelH: number,
  gap: number,
  bounds: { width: number; height: number },
): LabelCandidate[] {
  const out: LabelCandidate[] = [];
  const rings = 3;
  const ax = r.x; // anchor unused for rects (leader=0)
  const ay = r.y;
  for (let ring = 0; ring < rings; ring++) {
    const off = gap + 2 + ring * 6;
    // Above the rect (preferred)
    for (const align of ["start", "center", "end"] as const) {
      const lx =
        align === "start"
          ? r.x
          : align === "center"
            ? r.x + r.w / 2 - labelW / 2
            : r.x + r.w - labelW;
      const ly = r.y - labelH - off;
      out.push(clampCand(lx, ly, labelW, labelH, ax, ay, bounds));
    }
    // Left of the rect (preferred)
    for (const align of ["start", "center", "end"] as const) {
      const lx = r.x - labelW - off;
      const ly =
        align === "start"
          ? r.y
          : align === "center"
            ? r.y + r.h / 2 - labelH / 2
            : r.y + r.h - labelH;
      out.push(clampCand(lx, ly, labelW, labelH, ax, ay, bounds));
    }
    // Right of the rect
    for (const align of ["start", "center", "end"] as const) {
      const lx = r.x + r.w + off;
      const ly =
        align === "start"
          ? r.y
          : align === "center"
            ? r.y + r.h / 2 - labelH / 2
            : r.y + r.h - labelH;
      out.push(clampCand(lx, ly, labelW, labelH, ax, ay, bounds));
    }
    // Below the rect
    for (const align of ["start", "center", "end"] as const) {
      const lx =
        align === "start"
          ? r.x
          : align === "center"
            ? r.x + r.w / 2 - labelW / 2
            : r.x + r.w - labelW;
      const ly = r.y + r.h + off;
      out.push(clampCand(lx, ly, labelW, labelH, ax, ay, bounds));
    }
  }
  return out;
}

function clampCand(
  lx: number,
  ly: number,
  w: number,
  h: number,
  ax: number,
  ay: number,
  bounds: { width: number; height: number },
): LabelCandidate {
  const cx = Math.max(2, Math.min(bounds.width - w - 2, lx));
  const cy = Math.max(2, Math.min(bounds.height - h - 2, ly));
  return { x: cx, y: cy, w, h, ax, ay, leader: 0 };
}

const OVERLAP_PENALTY = 100_000;
const CIRCLE_PENALTY = 100_000;
const RECT_PENALTY = 50_000;

interface RectInfo {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Anchor {
  cx: number;
  cy: number;
}

function candidateCost(
  cand: LabelCandidate,
  selfIdx: number,
  positions: LabelCandidate[],
  circles: CircleInfo[],
  rects: RectInfo[],
  anchors: Anchor[],
): number {
  const self = anchors[selfIdx];
  const labelCx = cand.x + cand.w / 2;
  const labelCy = cand.y + cand.h / 2;
  const horizontalOffset = self ? Math.abs(labelCx - self.cx) : 0;
  // Bias: prefer above and left of the anchor.
  const dy = self ? labelCy - self.cy : 0;
  const dx = self ? labelCx - self.cx : 0;
  const belowPenalty = Math.max(0, dy) * 1.5;
  const rightPenalty = Math.max(0, dx) * 0.75;
  let cost = cand.leader + horizontalOffset * 0.5 + belowPenalty + rightPenalty;
  for (let j = 0; j < positions.length; j++) {
    if (j === selfIdx) continue;
    if (rectsOverlap(cand, positions[j])) cost += OVERLAP_PENALTY;
  }
  for (const c of circles) {
    if (rectIntersectsCircle(cand, c)) cost += CIRCLE_PENALTY;
  }
  for (const r of rects) {
    if (rectsOverlap(cand, r)) cost += RECT_PENALTY;
  }
  return cost;
}

function optimizePlacements(
  candidatesPerLabel: LabelCandidate[][],
  circles: CircleInfo[],
  rects: RectInfo[],
  anchors: Anchor[],
): LabelCandidate[] {
  const positions: LabelCandidate[] = candidatesPerLabel.map(
    (cands) => cands.reduce((best, c) => (c.leader < best.leader ? c : best), cands[0]),
  );
  const maxIters = 8;
  for (let iter = 0; iter < maxIters; iter++) {
    let improved = false;
    for (let i = 0; i < positions.length; i++) {
      let bestCand = positions[i];
      let bestCost = candidateCost(bestCand, i, positions, circles, rects, anchors);
      for (const cand of candidatesPerLabel[i]) {
        const cost = candidateCost(cand, i, positions, circles, rects, anchors);
        if (cost < bestCost - 0.01) {
          bestCost = cost;
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
  return positions;
}

export const OverlayLayer = ({
  overlays,
  pageSize,
  hoveredId,
  viewScale = 1,
  defaultColor = "hsl(var(--destructive))",
  onOverlayClick,
  onOverlayDrag,
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
        // previous size) so they don't obscure the drawing. Unit-marker dots
        // keep their original size.
        const diameter = isDot
          ? Math.max(10, MIN_CIRCLE_DIAMETER_CSS * 0.55)
          : Math.max(MIN_CIRCLE_DIAMETER_CSS, bboxSidePx * 1.5) * 0.3;

        return {
          id: o.id,
          cx,
          cy,
          r: diameter / 2,
          color,
          label: isDot ? undefined : o.label,
          hovered: hoveredId === o.id,
          isDot,
        };
      });
  }, [overlays, pageSize.width, pageSize.height, defaultColor, hoveredId]);

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
        hovered: hoveredId === o.id,
      }));
  }, [overlays, pageSize.width, pageSize.height, defaultColor, hoveredId]);

  const rectFootprints: RectInfo[] = useMemo(
    () => rects.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h })),
    [rects],
  );

  const fontPx = LABEL_FONT_PX;
  const padX = LABEL_PAD_X;
  const labelH = LABEL_H;
  const gap = LABEL_GAP;
  const charPx = fontPx * 0.62;

  const placedLabels: PlacedLabel[] = useMemo(() => {
    const labeledCircles = circles.filter((c) => !!c.label);
    const labeledRects = rects.filter((r) => !!r.label);
    if (labeledCircles.length === 0 && labeledRects.length === 0) return [];

    const items: {
      id: string;
      color: string;
      text: string;
      kind: "circle" | "rect";
      anchor: Anchor;
      width: number;
    }[] = [];
    for (const c of labeledCircles) {
      items.push({
        id: c.id,
        color: c.color,
        text: c.label!,
        kind: "circle",
        anchor: { cx: c.cx, cy: c.cy },
        width: Math.ceil(c.label!.length * charPx) + padX * 2,
      });
    }
    for (const r of labeledRects) {
      items.push({
        id: r.id,
        color: r.color,
        text: r.label!,
        kind: "rect",
        // Anchor near top-left so the above/left bias attracts labels there.
        anchor: { cx: r.x, cy: r.y },
        width: Math.ceil(r.label!.length * charPx) + padX * 2,
      });
    }

    const candidatesPerLabel: LabelCandidate[][] = items.map((it, i) => {
      if (it.kind === "circle") {
        const c = labeledCircles[i];
        return generateCircleCandidates(c, it.width, labelH, gap, pageSize);
      }
      const r = labeledRects[i - labeledCircles.length];
      return generateRectCandidates(r, it.width, labelH, gap, pageSize);
    });

    const anchors = items.map((it) => it.anchor);
    const positions = optimizePlacements(
      candidatesPerLabel,
      circles,
      rectFootprints,
      anchors,
    );
    return positions.map((p, i) => ({
      ...p,
      id: items[i].id,
      color: items[i].color,
      text: items[i].text,
      kind: items[i].kind,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circles, rects, rectFootprints, pageSize.width, pageSize.height, fontPx, padX, labelH, gap, charPx]);

  return (
    <div
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
          const dx = labelCx - p.ax;
          const dy = labelCy - p.ay;
          const len = Math.hypot(dx, dy) || 1;
          const ux = dx / len;
          const uy = dy / len;
          const c = circles.find((c) => c.id === p.id);
          const startInset = c ? 1 : 0;
          const x1 = p.ax - ux * startInset;
          const y1 = p.ay - uy * startInset;
          const ex = Math.max(p.x, Math.min(labelCx, p.x + p.w));
          const ey = Math.max(p.y, Math.min(labelCy, p.y + p.h));
          const x2 = ex + ux * 1;
          const y2 = ey + uy * 1;
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
              strokeWidth={1.5}
              opacity={LABEL_OPACITY}
            />
          );
        })}
      </svg>

      {circles.map((c) => {
        const clickable = !!onOverlayClick;
        // Any circle overlay is draggable when a drag handler is wired up —
        // annotation circles as well as dots. Click still fires when the
        // pointer barely moves (< DRAG_THRESHOLD).
        const draggable = !!onOverlayDrag;
        const isDragging = drag?.id === c.id;
        const dotBaseAlpha = draggable ? 0.5 : (c.hovered ? 0.85 : 0.7);
        const style: CSSProperties = c.isDot
          ? {
              position: "absolute",
              left: c.cx - c.r + (isDragging ? drag!.dx : 0),
              top: c.cy - c.r + (isDragging ? drag!.dy : 0),
              width: c.r * 2,
              height: c.r * 2,
              borderRadius: "9999px",
              backgroundColor: withAlpha(c.color, dotBaseAlpha),
              boxSizing: "border-box",
              pointerEvents: clickable || draggable ? "auto" : "none",
              cursor: draggable
                ? isDragging
                  ? "grabbing"
                  : "grab"
                : clickable
                  ? "pointer"
                  : undefined,
              touchAction: draggable ? "none" : undefined,
            }
          : {
              position: "absolute",
              left: c.cx - c.r + (isDragging ? drag!.dx : 0),
              top: c.cy - c.r + (isDragging ? drag!.dy : 0),
              width: c.r * 2,
              height: c.r * 2,
              borderRadius: "9999px",
              borderColor: withAlpha(c.color, 0.5),
              borderWidth: c.hovered ? 3.5 : 2.5,
              borderStyle: "solid",
              backgroundColor: withAlpha(c.color, c.hovered ? 0.35 : 0.2),
              boxSizing: "border-box",
              pointerEvents: clickable || draggable ? "auto" : "none",
              cursor: draggable
                ? isDragging
                  ? "grabbing"
                  : "grab"
                : clickable
                  ? "pointer"
                  : undefined,
              touchAction: draggable ? "none" : undefined,
            };

        const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

        const DRAG_THRESHOLD = 4;
        const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
          e.stopPropagation();
          if (!draggable) return;
          (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
          setDrag({
            id: c.id,
            startClientX: e.clientX,
            startClientY: e.clientY,
            dx: 0,
            dy: 0,
            moved: false,
          });
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
          const moved =
            cur.moved ||
            Math.hypot(rawDx, rawDy) > DRAG_THRESHOLD;
          setDrag({ ...cur, dx, dy, moved });
        };
        const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
          e.stopPropagation();
          const cur = dragRef.current;
          if (draggable && cur && cur.id === c.id) {
            try {
              (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
            } catch { /* ignore */ }
            if (cur.moved) {
              const newCx = c.cx + cur.dx;
              const newCy = c.cy + cur.dy;
              const nx = Math.max(0, Math.min(1, newCx / pageSize.width));
              const ny = Math.max(0, Math.min(1, newCy / pageSize.height));
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
            key={c.id}
            data-export-kind="circle"
            className={draggable ? "overlay-draggable" : undefined}
            data-color={c.color}
            data-cx={c.cx}
            data-cy={c.cy}
            data-radius={c.r}
            style={style}
            onPointerDown={
              draggable ? onPointerDown : clickable ? stop : undefined
            }
            onPointerMove={draggable ? onPointerMove : undefined}
            onPointerUp={
              draggable ? onPointerUp : clickable ? stop : undefined
            }
            onClick={
              !draggable && clickable
                ? (e) => {
                    e.stopPropagation();
                    onOverlayClick!(c.id);
                  }
                : (e) => e.stopPropagation()
            }
          />
        );
      })}


      {/* Rectangle overlays — outline only. Labels are placed by the optimizer below. */}
      {rects.map((r) => (
        <div key={r.id} style={{ position: "absolute", left: r.x, top: r.y }}>
          <div
            style={{
              width: r.w,
              height: r.h,
              borderColor: withAlpha(r.color, 0.5),
              borderWidth: r.hovered ? 3 : 2,
              borderStyle: "solid",
              backgroundColor: "transparent",
              boxSizing: "border-box",
              pointerEvents: "none",
            }}
          />
        </div>
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
          className="absolute font-bold whitespace-nowrap pointer-events-none text-center"
          style={{
            left: p.x,
            top: p.y,
            width: p.w,
            height: p.h,
            lineHeight: `${p.h}px`,
            fontSize: fontPx,
            paddingLeft: padX,
            paddingRight: padX,
            boxSizing: "border-box",
            borderRadius: 3,
            backgroundColor: p.color,
            color: readableTextOn(p.color),
            opacity: LABEL_OPACITY,
          }}
        >
          {p.text}
        </div>
      ))}

    </div>
  );
};
