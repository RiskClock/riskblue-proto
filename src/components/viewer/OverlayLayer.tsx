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
 */
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
        const left = o.rect.nx * pageSize.width;
        const top = o.rect.ny * pageSize.height;
        const width = o.rect.nw * pageSize.width;
        const height = o.rect.nh * pageSize.height;
        const color = o.color ?? defaultColor;
        const hovered = hoveredId === o.id;

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
