import { CSSProperties, useMemo } from "react";
import type { NormalizedOverlay } from "./viewerGeometry";

interface OverlayLayerProps {
  overlays: NormalizedOverlay[];
  /** Page CSS size at scale = 1 (the size the surface img is rendered at). */
  pageSize: { width: number; height: number };
  hoveredId?: string | null;
  defaultColor?: string;
  /** When provided, clicking an overlay invokes this with its id. */
  onOverlayClick?: (id: string) => void;
}

const MIN_CIRCLE_DIAMETER_CSS = 34;

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
}

interface PlacedLabel {
  id: string;
  // Label rect (in page CSS px, scale=1)
  x: number;
  y: number;
  w: number;
  h: number;
  // Anchor (circle edge) for leader line
  ax: number;
  ay: number;
  color: string;
  text: string;
}

// Estimate label width without rendering; refined after mount.
const LABEL_FONT_PX = 10;
const LABEL_PAD_X = 4;
const LABEL_H = 14;

function estimateLabelWidth(text: string): number {
  // Approximate average char width for 10px bold monospace-ish text
  return Math.ceil(text.length * 6.2) + LABEL_PAD_X * 2;
}

function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
  pad = 2,
): boolean {
  return !(
    a.x + a.w + pad <= b.x ||
    b.x + b.w + pad <= a.x ||
    a.y + a.h + pad <= b.y ||
    b.y + b.h + pad <= a.y
  );
}

/**
 * Pick a non-overlapping label position around a circle. Tries 16 directions
 * at increasing distances; if all fail, returns the closest candidate.
 */
function placeLabel(
  circle: CircleInfo,
  labelW: number,
  labelH: number,
  placed: PlacedLabel[],
  bounds: { width: number; height: number },
  circles: CircleInfo[],
): PlacedLabel {
  const text = circle.label!;
  const directions = 16;
  const maxRings = 6;
  const gap = 8;

  let fallback: PlacedLabel | null = null;

  for (let ring = 0; ring < maxRings; ring++) {
    const dist = circle.r + gap + ring * 12;
    for (let i = 0; i < directions; i++) {
      // Start above (angle = -PI/2) and sweep clockwise
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / directions;
      const lx = circle.cx + Math.cos(angle) * dist - labelW / 2;
      const ly = circle.cy + Math.sin(angle) * dist - labelH / 2;

      // Keep inside the page
      const x = Math.max(2, Math.min(bounds.width - labelW - 2, lx));
      const y = Math.max(2, Math.min(bounds.height - labelH - 2, ly));

      const rect = { x, y, w: labelW, h: labelH };

      // Avoid overlap with other labels
      const overlapsLabel = placed.some((p) => rectsOverlap(rect, p));
      // Avoid overlap with OTHER circles (allow own circle to be near)
      const overlapsCircle = circles.some((c) => {
        if (c.id === circle.id) return false;
        // Distance from rect to circle center
        const closestX = Math.max(rect.x, Math.min(c.cx, rect.x + rect.w));
        const closestY = Math.max(rect.y, Math.min(c.cy, rect.y + rect.h));
        const dx = c.cx - closestX;
        const dy = c.cy - closestY;
        return dx * dx + dy * dy < c.r * c.r;
      });

      const candidate: PlacedLabel = {
        id: circle.id,
        x,
        y,
        w: labelW,
        h: labelH,
        ax: circle.cx + Math.cos(angle) * circle.r,
        ay: circle.cy + Math.sin(angle) * circle.r,
        color: circle.color,
        text,
      };

      if (!overlapsLabel && !overlapsCircle) return candidate;
      if (!fallback) fallback = candidate;
    }
  }
  return fallback!;
}

export const OverlayLayer = ({
  overlays,
  pageSize,
  hoveredId,
  defaultColor = "hsl(var(--destructive))",
  onOverlayClick,
}: OverlayLayerProps) => {
  const circles: CircleInfo[] = useMemo(() => {
    return overlays.map((o) => {
      const color = o.color ?? defaultColor;
      const cx = (o.rect.nx + o.rect.nw / 2) * pageSize.width;
      const cy = (o.rect.ny + o.rect.nh / 2) * pageSize.height;
      const bboxSidePx = Math.max(
        o.rect.nw * pageSize.width,
        o.rect.nh * pageSize.height,
      );
      const diameter = Math.max(MIN_CIRCLE_DIAMETER_CSS, bboxSidePx * 1.5);
      return {
        id: o.id,
        cx,
        cy,
        r: diameter / 2,
        color,
        label: o.label,
        hovered: hoveredId === o.id,
      };
    });
  }, [overlays, pageSize.width, pageSize.height, defaultColor, hoveredId]);

  const placedLabels: PlacedLabel[] = useMemo(() => {
    const result: PlacedLabel[] = [];
    // Place labels in a stable order (by y then x) so layout is deterministic.
    const order = [...circles]
      .filter((c) => !!c.label)
      .sort((a, b) => a.cy - b.cy || a.cx - b.cx);
    for (const c of order) {
      const w = estimateLabelWidth(c.label!);
      result.push(placeLabel(c, w, LABEL_H, result, pageSize, circles));
    }
    return result;
  }, [circles, pageSize.width, pageSize.height]);

  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{ width: pageSize.width, height: pageSize.height }}
    >
      {/* Leader lines layer (SVG, behind circles) */}
      <svg
        className="absolute inset-0 pointer-events-none"
        width={pageSize.width}
        height={pageSize.height}
        style={{ overflow: "visible" }}
      >
        {placedLabels.map((p) => {
          // Endpoint: nearest point on label rect to anchor
          const lx = Math.max(p.x, Math.min(p.ax, p.x + p.w));
          const ly = Math.max(p.y, Math.min(p.ay, p.y + p.h));
          return (
            <line
              key={`leader-${p.id}`}
              x1={p.ax}
              y1={p.ay}
              x2={lx}
              y2={ly}
              stroke={p.color}
              strokeWidth={1}
              opacity={0.85}
            />
          );
        })}
      </svg>

      {circles.map((c) => {
        const clickable = !!onOverlayClick;
        const style: CSSProperties = {
          position: "absolute",
          left: c.cx - c.r,
          top: c.cy - c.r,
          width: c.r * 2,
          height: c.r * 2,
          borderRadius: "9999px",
          borderColor: c.color,
          borderWidth: c.hovered ? 2 : 1.5,
          borderStyle: "solid",
          backgroundColor: withAlpha(c.color, c.hovered ? 0.28 : 0.22),
          boxSizing: "border-box",
          pointerEvents: clickable ? "auto" : "none",
          cursor: clickable ? "pointer" : undefined,
        };
        const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
        return (
          <div
            key={c.id}
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

      {/* Labels layer (above circles) */}
      {placedLabels.map((p) => (
        <div
          key={`label-${p.id}`}
          className="absolute font-bold text-white whitespace-nowrap rounded-sm pointer-events-none text-center"
          style={{
            left: p.x,
            top: p.y,
            width: p.w,
            height: p.h,
            lineHeight: `${p.h}px`,
            fontSize: LABEL_FONT_PX,
            paddingLeft: LABEL_PAD_X,
            paddingRight: LABEL_PAD_X,
            backgroundColor: withAlpha(p.color, 0.85),
          }}
        >
          {p.text}
        </div>
      ))}
    </div>
  );
};
