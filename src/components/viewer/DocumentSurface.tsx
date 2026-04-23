import { CSSProperties } from "react";
import { OverlayLayer } from "./OverlayLayer";
import type { NormalizedOverlay } from "./viewerGeometry";

interface DocumentSurfaceProps {
  imageUrl: string;
  pageSize: { width: number; height: number }; // CSS px at scale 1
  overlays?: NormalizedOverlay[];
  hoveredOverlayId?: string | null;
}

/**
 * Renders a single rasterized page (or image) as a CSS-sized <img>, with an
 * absolutely-positioned overlay layer on top. Sized in CSS pixels so the
 * react-zoom-pan-pinch transform scales it (and overlays) together.
 */
export const DocumentSurface = ({
  imageUrl,
  pageSize,
  overlays,
  hoveredOverlayId,
}: DocumentSurfaceProps) => {
  const style: CSSProperties = {
    width: pageSize.width,
    height: pageSize.height,
    position: "relative",
    userSelect: "none",
  };
  return (
    <div style={style}>
      <img
        src={imageUrl}
        draggable={false}
        style={{
          width: pageSize.width,
          height: pageSize.height,
          display: "block",
          pointerEvents: "none",
        }}
      />
      {overlays && overlays.length > 0 && (
        <OverlayLayer
          overlays={overlays}
          pageSize={pageSize}
          hoveredId={hoveredOverlayId}
        />
      )}
    </div>
  );
};
