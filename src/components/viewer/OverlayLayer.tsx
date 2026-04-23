import { CSSProperties } from "react";
import type { NormalizedOverlay } from "./viewerGeometry";

interface OverlayLayerProps {
  overlays: NormalizedOverlay[];
  /** Page CSS size at scale = 1 (the size the surface img is rendered at). */
  pageSize: { width: number; height: number };
  hoveredId?: string | null;
  defaultColor?: string;
}

/**
 * Renders overlays in normalized coordinates, absolutely positioned over a
 * page surface. Lives inside <TransformComponent> so it shares the same
 * transform as the document.
 *
 * Two shapes are supported (selected per-overlay via NormalizedOverlay.shape):
 *  - "rect"   — bordered translucent box sized exactly to the bbox.
 *  - "circle" — translucent disc with outline, centered on the bbox centroid.
 *               Diameter is derived from the bbox in document space (so it
 *               scales naturally with the page) with a CSS minimum to keep
 *               tiny markers visible at fit-page zoom.
 */
const MIN_CIRCLE_DIAMETER_CSS = 28; // px at scale=1 — keeps single-point markers visible

export const OverlayLayer = ({
  overlays,
  pageSize,
  hoveredId,
  defaultColor = "#39FF14",
}: OverlayLayerProps) => {
  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{ width: pageSize.width, height: pageSize.height }}
    >
      {overlays.map((o) => {
        const color = o.color ?? defaultColor;
        const hovered = hoveredId === o.id;
        const shape = o.shape ?? "rect";

        if (shape === "circle") {
          // Centroid of the bbox in document (CSS) coordinates.
          const cx = (o.rect.nx + o.rect.nw / 2) * pageSize.width;
          const cy = (o.rect.ny + o.rect.nh / 2) * pageSize.height;

          // Diameter is derived from the bbox in document space (largest side),
          // padded slightly so the marker fully covers the target. Minimum CSS
          // size only acts as a floor for tiny bboxes (e.g. label-point hits).
          const bboxSidePx = Math.max(
            o.rect.nw * pageSize.width,
            o.rect.nh * pageSize.height
          );
          const diameter = Math.max(MIN_CIRCLE_DIAMETER_CSS, bboxSidePx * 1.25);

          const style: CSSProperties = {
            position: "absolute",
            left: cx - diameter / 2,
            top: cy - diameter / 2,
            width: diameter,
            height: diameter,
            borderRadius: "9999px",
            borderColor: color,
            borderWidth: hovered ? 3 : 2,
            borderStyle: "solid",
            backgroundColor: `${color}33`, // ~20% alpha translucent fill
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
        }

        // shape === "rect" (default)
        const left = o.rect.nx * pageSize.width;
        const top = o.rect.ny * pageSize.height;
        const width = o.rect.nw * pageSize.width;
        const height = o.rect.nh * pageSize.height;

        const style: CSSProperties = {
          position: "absolute",
          left,
          top,
          width,
          height,
          borderColor: color,
          borderWidth: hovered ? 4 : 2,
          borderStyle: "solid",
          backgroundColor: `${color}${hovered ? "40" : "20"}`,
          boxSizing: "border-box",
        };

        return (
          <div key={o.id} style={style}>
            {o.label && (
              <div
                className="absolute -top-5 left-0 px-1 text-[10px] font-bold text-white"
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
