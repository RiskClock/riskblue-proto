import {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  useLayoutEffect,
  useRef,
} from "react";
import { OverlayLayer } from "./OverlayLayer";
import type { NormalizedOverlay } from "./viewerGeometry";

export interface EditorBbox {
  nx: number;
  ny: number;
  nw: number;
  nh: number;
}

interface DocumentSurfaceProps {
  imageUrl: string;
  pageSize: { width: number; height: number };
  overlays?: NormalizedOverlay[];
  hoveredOverlayId?: string | null;
  viewScale?: number;
  onCanvasClick?: (nx: number, ny: number) => void;
  onOverlayClick?: (overlayId: string) => void;
  onOverlayDrag?: (overlayId: string, nx: number, ny: number) => void;
  onRenderedSizeChange?: (size: { width: number; height: number }) => void;
  /** When set, renders a bounding-box editor on top of the page. */
  editorBbox?: EditorBbox | null;
  /** Live change while dragging. */
  onEditorBboxChange?: (next: EditorBbox) => void;
  /** Border / corner-handle color for the editor bbox. Defaults to primary. */
  editorColor?: string;
}

const CLICK_MOVE_THRESHOLD = 4;

type HandleId =
  | "move"
  | "n"
  | "s"
  | "e"
  | "w"
  | "nw"
  | "ne"
  | "sw"
  | "se";

const HANDLE_CURSORS: Record<HandleId, string> = {
  move: "move",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
};

export const DocumentSurface = ({
  imageUrl,
  pageSize,
  overlays,
  hoveredOverlayId,
  viewScale,
  onCanvasClick,
  onOverlayClick,
  onRenderedSizeChange,
  editorBbox,
  onEditorBboxChange,
  editorColor,
}: DocumentSurfaceProps) => {
  const downRef = useRef<{ x: number; y: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const editing = !!editorBbox;
  const style: CSSProperties = {
    width: pageSize.width,
    height: pageSize.height,
    position: "relative",
    userSelect: "none",
    cursor: !editing && onCanvasClick ? "crosshair" : undefined,
  };
  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    downRef.current = { x: e.clientX, y: e.clientY };
  };
  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = downRef.current;
    downRef.current = null;
    if (editing) return; // disable click-to-mark while editing a bbox
    if (!onCanvasClick || !start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.hypot(dx, dy) > CLICK_MOVE_THRESHOLD) return;
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

  // ---- Editor handles ----
  const startEditorDrag = (
    e: ReactPointerEvent<HTMLDivElement>,
    handle: HandleId,
  ) => {
    if (!editorBbox || !onEditorBboxChange) return;
    e.stopPropagation();
    e.preventDefault();
    const targetEl = e.currentTarget;
    targetEl.setPointerCapture(e.pointerId);
    // Use the page surface's rect — already reflects current zoom because the
    // whole surface is inside the TransformWrapper.
    const surface = targetEl.closest("[data-doc-surface]") as HTMLElement | null;
    const surfRect = surface?.getBoundingClientRect();
    if (!surfRect) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const start = { ...editorBbox };

    const move = (ev: PointerEvent) => {
      const dxN = (ev.clientX - startX) / surfRect.width;
      const dyN = (ev.clientY - startY) / surfRect.height;
      let { nx, ny, nw, nh } = start;
      const MIN = 0.01;
      if (handle === "move") {
        nx = Math.max(0, Math.min(1 - nw, start.nx + dxN));
        ny = Math.max(0, Math.min(1 - nh, start.ny + dyN));
      } else {
        if (handle.includes("w")) {
          const nxRaw = Math.min(start.nx + start.nw - MIN, Math.max(0, start.nx + dxN));
          nw = start.nw + (start.nx - nxRaw);
          nx = nxRaw;
        }
        if (handle.includes("e")) {
          nw = Math.max(MIN, Math.min(1 - start.nx, start.nw + dxN));
        }
        if (handle.includes("n")) {
          const nyRaw = Math.min(start.ny + start.nh - MIN, Math.max(0, start.ny + dyN));
          nh = start.nh + (start.ny - nyRaw);
          ny = nyRaw;
        }
        if (handle.includes("s")) {
          nh = Math.max(MIN, Math.min(1 - start.ny, start.nh + dyN));
        }
      }
      onEditorBboxChange({ nx, ny, nw, nh });
    };
    const up = (ev: PointerEvent) => {
      try { targetEl.releasePointerCapture(ev.pointerId); } catch { /* */ }
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const renderEditor = () => {
    if (!editorBbox) return null;
    const left = editorBbox.nx * pageSize.width;
    const top = editorBbox.ny * pageSize.height;
    const width = editorBbox.nw * pageSize.width;
    const height = editorBbox.nh * pageSize.height;
    const handleSize = 10;
    const half = handleSize / 2;
    const edgeColor = editorColor || "hsl(var(--primary))";
    const handles: { id: HandleId; left: number; top: number; w: number; h: number }[] = [
      // edges (thin strips)
      { id: "n", left: 0, top: -half, w: width, h: handleSize },
      { id: "s", left: 0, top: height - half, w: width, h: handleSize },
      { id: "w", left: -half, top: 0, w: handleSize, h: height },
      { id: "e", left: width - half, top: 0, w: handleSize, h: height },
      // corners (on top)
      { id: "nw", left: -half, top: -half, w: handleSize, h: handleSize },
      { id: "ne", left: width - half, top: -half, w: handleSize, h: handleSize },
      { id: "sw", left: -half, top: height - half, w: handleSize, h: handleSize },
      { id: "se", left: width - half, top: height - half, w: handleSize, h: handleSize },
    ];
    return (
      <div
        className="absolute"
        style={{ left, top, width, height, pointerEvents: "none" }}
      >
        {/* Move area + dotted border */}
        <div
          onPointerDown={(e) => startEditorDrag(e, "move")}
          style={{
            position: "absolute",
            inset: 0,
            border: `2px dashed ${edgeColor}`,
            backgroundColor: "transparent",
            cursor: HANDLE_CURSORS.move,
            pointerEvents: "auto",
            boxSizing: "border-box",
            boxShadow: "0 0 0 1px rgba(255,255,255,0.9)",
          }}
        />
        {handles.map((h) => (
          <div
            key={h.id}
            onPointerDown={(e) => startEditorDrag(e, h.id)}
            style={{
              position: "absolute",
              left: h.left,
              top: h.top,
              width: h.w,
              height: h.h,
              cursor: HANDLE_CURSORS[h.id],
              pointerEvents: "auto",
              backgroundColor: h.id.length <= 2 && (h.id === "nw" || h.id === "ne" || h.id === "sw" || h.id === "se")
                ? edgeColor
                : "transparent",
              border: (h.id === "nw" || h.id === "ne" || h.id === "sw" || h.id === "se")
                ? "1px solid white"
                : undefined,
              boxSizing: "border-box",
              borderRadius: 2,
            }}
          />
        ))}
      </div>
    );
  };

  return (
    <div
      data-doc-surface
      style={style}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
    >
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
      {renderEditor()}
    </div>
  );
};
