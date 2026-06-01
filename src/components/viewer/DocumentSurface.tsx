import { CSSProperties, MouseEvent } from "react";
import { OverlayLayer } from "./OverlayLayer";
import type { NormalizedOverlay } from "./viewerGeometry";

interface DocumentSurfaceProps {
  imageUrl: string;
  pageSize: { width: number; height: number }; // CSS px at scale 1
  overlays?: NormalizedOverlay[];
  hoveredOverlayId?: string | null;
  /** Click handler that receives normalized (0..1) coordinates within the page. */
  onCanvasClick?: (nx: number, ny: number) => void;
  /** Optional click handler invoked when user clicks on an overlay. */
  onOverlayClick?: (overlayId: string) => void;
}

/**
 * Renders a single rasterized page (or image) as a CSS-sized <img>, with an
 * absolutely-positioned overlay layer on top.
 */
export const DocumentSurface = ({
  imageUrl,
  pageSize,
  overlays,
  hoveredOverlayId,
  onCanvasClick,
  onOverlayClick,
}: DocumentSurfaceProps) => {
  const style: CSSProperties = {
    width: pageSize.width,
    height: pageSize.height,
    position: "relative",
    userSelect: "none",
    cursor: onCanvasClick ? "crosshair" : undefined,
  };
  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!onCanvasClick) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    if (nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1) onCanvasClick(nx, ny);
  };
  return (
    <div style={style} onClick={handleClick}>
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

