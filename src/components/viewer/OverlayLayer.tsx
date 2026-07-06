import { CSSProperties, useMemo, useRef, useState } from "react";
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
const LABEL_FONT_PX = 11;
const LABEL_PAD_X = 6;
const LABEL_H = 18;
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
  ax: number; // anchor x on circle edge
  ay: number; // anchor y on circle edge
  leader: number; // base leader length
}

interface PlacedLabel extends LabelCandidate {
  id: string;
  color: string;
  text: string;
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
 * Generate candidate label positions around a circle: 16 directions × 3 rings,
 * with the label rect aligned so the nearest edge faces the circle (not centered).
 */
function generateCandidates(
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
      // Place label center at distance, then offset so nearest edge points at circle
      const labelCx = c.cx + cos * dist;
      const labelCy = c.cy + sin * dist;
      let lx = labelCx - labelW / 2;
      let ly = labelCy - labelH / 2;
      // Clamp inside page
      lx = Math.max(2, Math.min(bounds.width - labelW - 2, lx));
      ly = Math.max(2, Math.min(bounds.height - labelH - 2, ly));
      const ax = c.cx + cos * c.r;
      const ay = c.cy + sin * c.r;
      // Anchor leader end: nearest point on rect to circle center
      const ex = Math.max(lx, Math.min(c.cx, lx + labelW));
      const ey = Math.max(ly, Math.min(c.cy, ly + labelH));
      const leader = Math.hypot(ex - ax, ey - ay);
      out.push({ x: lx, y: ly, w: labelW, h: labelH, ax, ay, leader });
    }
  }
  return out;
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

function candidateCost(
  cand: LabelCandidate,
  selfIdx: number,
  positions: LabelCandidate[],
  circles: CircleInfo[],
  rects: RectInfo[],
): number {
  // Prefer labels horizontally centered with the annotation circle.
  const self = circles[selfIdx];
  const labelCx = cand.x + cand.w / 2;
  const labelCy = cand.y + cand.h / 2;
  const horizontalOffset = self ? Math.abs(labelCx - self.cx) : 0;
  // Direction bias: prefer above and left over below and right.
  // dy > 0 → label below the circle (penalize); dx > 0 → to the right (penalize lightly).
  const dy = self ? labelCy - self.cy : 0;
  const dx = self ? labelCx - self.cx : 0;
  const belowPenalty = Math.max(0, dy) * 1.5; // strong: prefer above
  const rightPenalty = Math.max(0, dx) * 0.75; // mild: prefer left
  let cost = cand.leader + horizontalOffset * 0.5 + belowPenalty + rightPenalty;
  for (let j = 0; j < positions.length; j++) {
    if (j === selfIdx) continue;
    if (rectsOverlap(cand, positions[j])) cost += OVERLAP_PENALTY;
  }
  for (const c of circles) {
    if (rectIntersectsCircle(cand, c)) cost += CIRCLE_PENALTY;
  }
  // Avoid overlapping bbox rectangles (floor-plan bounding boxes etc.)
  for (const r of rects) {
    if (rectsOverlap(cand, r)) cost += RECT_PENALTY;
  }
  return cost;
}

/**
 * Iterative global optimization: each label picks the candidate minimizing
 * total cost (leader length + overlap penalties) given the others' current
 * positions. Repeats until no improvement.
 */
function optimizePlacements(
  candidatesPerLabel: LabelCandidate[][],
  circles: CircleInfo[],
  rects: RectInfo[],
): LabelCandidate[] {
  // Initialize with shortest-leader candidate
  const positions: LabelCandidate[] = candidatesPerLabel.map(
    (cands) => cands.reduce((best, c) => (c.leader < best.leader ? c : best), cands[0]),
  );
  const maxIters = 8;
  for (let iter = 0; iter < maxIters; iter++) {
    let improved = false;
    for (let i = 0; i < positions.length; i++) {
      let bestCand = positions[i];
      let bestCost = candidateCost(bestCand, i, positions, circles, rects);
      for (const cand of candidatesPerLabel[i]) {
        const cost = candidateCost(cand, i, positions, circles, rects);
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
}: OverlayLayerProps) => {
  // viewScale is no longer used to size markers/labels — they scale with the
  // page transform naturally. Kept in the signature for backward compatibility.
  void viewScale;

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
        // Dot variant: fixed small filled disc, no border, no label.
        const isDot = o.variant === "dot";
        const diameter = isDot
          ? Math.max(10, MIN_CIRCLE_DIAMETER_CSS * 0.55)
          : Math.max(MIN_CIRCLE_DIAMETER_CSS, bboxSidePx * 1.5);

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

  // Rectangle overlays (outline only, no fill) — used for floor-plan bboxes.
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

  // Rect footprints in page-CSS space, used for label placement avoidance.
  const rectFootprints: RectInfo[] = useMemo(
    () => rects.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h })),
    [rects],
  );

  // Label sizing in unscaled page CSS px (constant in document space).
  const fontPx = LABEL_FONT_PX;
  const padX = LABEL_PAD_X;
  const labelH = LABEL_H;
  const gap = LABEL_GAP;
  const charPx = fontPx * 0.62; // bold sans-serif avg

  const placedLabels: PlacedLabel[] = useMemo(() => {
    const labeled = circles.filter((c) => !!c.label);
    if (labeled.length === 0) return [];
    const widths = labeled.map((c) =>
      Math.ceil(c.label!.length * charPx) + padX * 2,
    );
    const candidatesPerLabel = labeled.map((c, i) =>
      generateCandidates(c, widths[i], labelH, gap, pageSize),
    );
    const positions = optimizePlacements(candidatesPerLabel, circles, rectFootprints);
    return positions.map((p, i) => ({
      ...p,
      id: labeled[i].id,
      color: labeled[i].color,
      text: labeled[i].label!,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circles, rectFootprints, pageSize.width, pageSize.height, fontPx, padX, labelH, gap, charPx]);

  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{ width: pageSize.width, height: pageSize.height }}
    >
      {/* Leader lines (SVG, behind circles) */}
      <svg
        className="absolute inset-0 pointer-events-none"
        width={pageSize.width}
        height={pageSize.height}
        style={{ overflow: "visible" }}
      >
        {placedLabels.map((p, idx) => {
          // Endpoint at nearest point on label rect to anchor, then push 1px
          // inside the rect to guarantee no visible gap.
          const labelCx = p.x + p.w / 2;
          const labelCy = p.y + p.h / 2;
          const dx = labelCx - p.ax;
          const dy = labelCy - p.ay;
          const len = Math.hypot(dx, dy) || 1;
          const ux = dx / len;
          const uy = dy / len;
          // Start: just inside the circle border so the stroke overlaps it.
          const c = circles.find((c) => c.id === p.id);
          const startInset = c ? 1 : 0;
          const x1 = p.ax - ux * startInset;
          const y1 = p.ay - uy * startInset;
          // End: nearest point on label rect, pushed 1px inside.
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
        // Translucent border (50%) + light translucent fill (20%). Hover
        // slightly stronger. Dot variant: filled disc, no border.
        const style: CSSProperties = c.isDot
          ? {
              position: "absolute",
              left: c.cx - c.r,
              top: c.cy - c.r,
              width: c.r * 2,
              height: c.r * 2,
              borderRadius: "9999px",
              backgroundColor: withAlpha(c.color, c.hovered ? 0.85 : 0.7),
              boxShadow: `0 0 0 1px rgba(255,255,255,0.85)`,
              boxSizing: "border-box",
              pointerEvents: clickable ? "auto" : "none",
              cursor: clickable ? "pointer" : undefined,
            }
          : {
              position: "absolute",
              left: c.cx - c.r,
              top: c.cy - c.r,
              width: c.r * 2,
              height: c.r * 2,
              borderRadius: "9999px",
              borderColor: withAlpha(c.color, 0.5),
              borderWidth: c.hovered ? 3.5 : 2.5,
              borderStyle: "solid",
              backgroundColor: withAlpha(c.color, c.hovered ? 0.35 : 0.2),
              boxShadow: `0 0 0 1px rgba(255,255,255,0.85)`,
              boxSizing: "border-box",
              pointerEvents: clickable ? "auto" : "none",
              cursor: clickable ? "pointer" : undefined,
            };

        const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
        return (
          <div
            key={c.id}
            data-export-kind="circle"
            data-color={c.color}
            data-cx={c.cx}
            data-cy={c.cy}
            data-radius={c.r}
            style={style}
            onPointerDown={clickable ? stop : undefined}
            onPointerUp={clickable ? stop : undefined}
            onClick={
              clickable
                ? (e) => {
                    e.stopPropagation();
                    onOverlayClick!(c.id);
                  }
                : undefined
            }
          />
        );
      })}

      {/* Rectangle overlays — outline only, label pinned top-left. */}
      {rects.map((r) => {
        const labelFs = LABEL_FONT_PX;
        return (
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
                boxShadow: `0 0 0 1px rgba(255,255,255,0.6)`,
              }}
            />

            {r.label ? (
              <div
                className="absolute font-bold whitespace-nowrap pointer-events-none"
                style={{
                  left: 0,
                  top: -(LABEL_H + 2),
                  height: LABEL_H,
                  lineHeight: `${LABEL_H}px`,
                  fontSize: labelFs,
                  paddingLeft: LABEL_PAD_X,
                  paddingRight: LABEL_PAD_X,
                  borderRadius: 3,
                  backgroundColor: r.color,
                  color: readableTextOn(r.color),
                  boxShadow: `0 0 0 1px rgba(255,255,255,0.9)`,
                  opacity: LABEL_OPACITY,
                }}
              >
                {r.label}
              </div>
            ) : null}
          </div>
        );
      })}


      {/* Labels (above circles). Intrinsic width hugs the text. */}
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
            boxShadow: `0 0 0 1px rgba(255,255,255,0.9)`,
            opacity: LABEL_OPACITY,
          }}
        >
          {p.text}
        </div>
      ))}

    </div>
  );
};
