import { CSSProperties } from "react";
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

/**
 * Renders drawing highlights in normalized coordinates, absolutely positioned
 * over a page surface. Lives inside <TransformComponent> so it shares the same
 * transform as the document.
 *
 * Product rule: any highlight shown on the drawing uses the same red circle
 * treatment. The incoming bbox is still used for centroid + fit math, but the
 * rendered mark is always a translucent circle with a visible outline.
 */
const MIN_CIRCLE_DIAMETER_CSS = 34; // 20% larger than the previous 28px floor

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
        ? hex
            .split("")
            .map((char) => `${char}${char}`)
            .join("")
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

export const OverlayLayer = ({
  overlays,
  pageSize,
  hoveredId,
  defaultColor = "hsl(var(--destructive))",
  onOverlayClick,
}: OverlayLayerProps) => {
  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{ width: pageSize.width, height: pageSize.height }}
    >

      {overlays.map((o) => {
        const color = o.color ?? defaultColor;
        const hovered = hoveredId === o.id;

        // Geometry stays anchored in document space (normalized bbox), while the
        // visual treatment is always a circle centered on the bbox centroid.
        const cx = (o.rect.nx + o.rect.nw / 2) * pageSize.width;
        const cy = (o.rect.ny + o.rect.nh / 2) * pageSize.height;
        const bboxSidePx = Math.max(
          o.rect.nw * pageSize.width,
          o.rect.nh * pageSize.height
        );
        const diameter = Math.max(MIN_CIRCLE_DIAMETER_CSS, bboxSidePx * 1.5);

        const style: CSSProperties = {
          position: "absolute",
          left: cx - diameter / 2,
          top: cy - diameter / 2,
          width: diameter,
          height: diameter,
          borderRadius: "9999px",
          borderColor: color,
          borderWidth: hovered ? 2 : 1.5,
          borderStyle: "solid",
          backgroundColor: withAlpha(color, hovered ? 0.28 : 0.22),
          boxSizing: "border-box",
        };

        return (
          <div key={o.id} style={style}>
            {o.label && (
              <div
                className="absolute -top-5 left-1/2 -translate-x-1/2 px-1 text-[10px] font-bold text-white whitespace-nowrap rounded-sm"
                style={{ backgroundColor: color }}
              >
                {o.label}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
