import {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  useLayoutEffect,
  useRef,
} from "react";
import { OverlayLayer } from "./OverlayLayer";
import type { NormalizedOverlay } from "./viewerGeometry";

interface DocumentSurfaceProps {
  imageUrl: string;
  pageSize: { width: number; height: number }; // CSS px at scale 1
  overlays?: NormalizedOverlay[];
  hoveredOverlayId?: string | null;
  /** Current viewport zoom scale. Used to keep label text a constant on-screen size. */
  viewScale?: number;
  /** Click handler that receives normalized (0..1) coordinates within the page. */
  onCanvasClick?: (nx: number, ny: number) => void;
  /** Optional click handler invoked when user clicks on an overlay. */
  onOverlayClick?: (overlayId: string) => void;
  /** Reports the actual rendered page element size in CSS pixels. */
  onRenderedSizeChange?: (size: { width: number; height: number }) => void;
}

/** Max pointer movement (CSS px) between down and up to still count as a click,
 *  rather than a pan gesture. */
const CLICK_MOVE_THRESHOLD = 4;

/**
 * Renders a single rasterized page (or image) as a CSS-sized <img>, with an
 * absolutely-positioned overlay layer on top.
 */
export const DocumentSurface = ({
  imageUrl,
  pageSize,
  overlays,
  hoveredOverlayId,
  viewScale,
  onCanvasClick,
  onOverlayClick,
  onRenderedSizeChange,
}: DocumentSurfaceProps) => {
  const downRef = useRef<{ x: number; y: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const style: CSSProperties = {
    width: pageSize.width,
    height: pageSize.height,
    position: "relative",
    userSelect: "none",
    cursor: onCanvasClick ? "crosshair" : undefined,
  };
  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    downRef.current = { x: e.clientX, y: e.clientY };
  };
  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = downRef.current;
    downRef.current = null;
    if (!onCanvasClick || !start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.hypot(dx, dy) > CLICK_MOVE_THRESHOLD) return; // panned, ignore
    const rect = e.currentTarget.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    if (nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1) onCanvasClick(nx, ny);
  };

  useLayoutEffect(() => {
    const el = imgRef.current;
    if (!el || !onRenderedSizeChange) return;

    let frame = 0;
    const report = () => {
      const rect = el.getBoundingClientRect();
      const width = el.clientWidth || rect.width;
      const height = el.clientHeight || rect.height;
      if (width > 0 && height > 0) onRenderedSizeChange({ width, height });
    };
    const scheduleReport = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(report);
    };

    report();
    const ro = new ResizeObserver(scheduleReport);
    ro.observe(el);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [imageUrl, pageSize.width, pageSize.height, onRenderedSizeChange]);

  return (
    <div style={style} onPointerDown={handlePointerDown} onPointerUp={handlePointerUp}>
      <img
        ref={imgRef}
        className="pdf-canvas-element"
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
          viewScale={viewScale}
          onOverlayClick={onOverlayClick}
        />
      )}
    </div>
  );
};

