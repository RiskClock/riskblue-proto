import {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { OverlayLayer } from "./OverlayLayer";
import type { NormalizedOverlay, NormalizedPoint } from "./viewerGeometry";

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
  /**
   * Irregular polygon outline (0..1) for the shape being edited. When present
   * with >= 3 points the editor switches from the rectangle handles to
   * vertex/midpoint editing and `editorBbox` is treated as its envelope.
   */
  editorPoints?: NormalizedPoint[] | null;
  /** Live change while dragging / adding / deleting a vertex. */
  onEditorPointsChange?: (next: NormalizedPoint[]) => void;

  /** Border / corner-handle color for the editor bbox. Defaults to primary. */
  editorColor?: string;
  /**
   * Visual rotation (degrees CW) applied to the underlying page image only.
   * `pageSize` is expected to already reflect the rotated dimensions — this
   * prop rotates the raster inside that box. Overlays/editor bbox are passed
   * in already rotated by the caller.
   */
  rotation?: 0 | 90 | 180 | 270;
  /** Forwarded to OverlayLayer.syncPlacement. */
  syncPlacement?: boolean;
  /** Forwarded to OverlayLayer.onPlacingChange. */
  onPlacingChange?: (isPlacing: boolean) => void;
}


const CLICK_MOVE_THRESHOLD = 5;

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
  onOverlayDrag,
  onRenderedSizeChange,
  editorBbox,
  onEditorBboxChange,
  editorPoints,
  onEditorPointsChange,
  editorColor,
  rotation = 0,
  syncPlacement,
  onPlacingChange,
}: DocumentSurfaceProps) => {
  const downRef = useRef<{ x: number; y: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const editing = !!editorBbox;
  const polyPoints =
    editorPoints && editorPoints.length >= 3 ? editorPoints : null;
  const [selectedVertex, setSelectedVertex] = useState<number | null>(null);

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
    if (Math.hypot(dx, dy) >= CLICK_MOVE_THRESHOLD) return;
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
    // Use the page surface's rect - already reflects current zoom because the
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

  // ---- Polygon (irregular bbox) editing ----------------------------------
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

  /** Drag an existing vertex, or a whole polygon when `index` is null. */
  const startPolygonDrag = (
    e: ReactPointerEvent<Element>,
    index: number | null,
  ) => {
    if (!polyPoints || !onEditorPointsChange) return;
    e.stopPropagation();
    e.preventDefault();
    const targetEl = e.currentTarget as Element;
    try { targetEl.setPointerCapture(e.pointerId); } catch { /* */ }
    const surface = targetEl.closest("[data-doc-surface]") as HTMLElement | null;
    const surfRect = surface?.getBoundingClientRect();
    if (!surfRect) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const start = polyPoints.map((p) => ({ ...p }));
    let moved = false;

    const move = (ev: PointerEvent) => {
      const dxN = (ev.clientX - startX) / surfRect.width;
      const dyN = (ev.clientY - startY) / surfRect.height;
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) >= CLICK_MOVE_THRESHOLD) {
        moved = true;
      }
      if (!moved) return;
      let next: NormalizedPoint[];
      if (index === null) {
        next = start.map((p) => ({ nx: clamp01(p.nx + dxN), ny: clamp01(p.ny + dyN) }));
      } else {
        let nx = clamp01(start[index].nx + dxN);
        let ny = clamp01(start[index].ny + dyN);
        const prev = start[(index - 1 + start.length) % start.length];
        const nextPt = start[(index + 1) % start.length];
        // Shift snaps the vertex to a horizontal / vertical line with the
        // neighbouring vertex it is closest to aligning with.
        if (ev.shiftKey) {
          const cand = [prev, nextPt];
          const dxs = cand.map((c) => Math.abs(nx - c.nx));
          const dys = cand.map((c) => Math.abs(ny - c.ny));
          const minDx = Math.min(...dxs);
          const minDy = Math.min(...dys);
          if (minDx <= minDy) nx = cand[dxs.indexOf(minDx)].nx;
          else ny = cand[dys.indexOf(minDy)].ny;
        } else {
          // Auto-snap the corner to a true right angle when it is already
          // within 5 degrees of one. Work in page pixels so the aspect
          // ratio of the page doesn't distort the angle.
          const W = pageSize.width;
          const H = pageSize.height;
          const px = nx * W, py = ny * H;
          const ax = prev.nx * W - px, ay = prev.ny * H - py;
          const bx = nextPt.nx * W - px, by = nextPt.ny * H - py;
          const la = Math.hypot(ax, ay);
          const lb = Math.hypot(bx, by);
          if (la > 1e-6 && lb > 1e-6) {
            const cos = (ax * bx + ay * by) / (la * lb);
            const angle = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
            if (Math.abs(angle - 90) <= 5) {
              // Keep the edge to `prev` as-is and move the vertex so the
              // edge to `next` becomes perpendicular to it: project `next`
              // onto the line through `prev` in the direction of the corner.
              const ux = -ax / la, uy = -ay / la; // prev -> corner unit vector
              const pvx = nextPt.nx * W - prev.nx * W;
              const pvy = nextPt.ny * H - prev.ny * H;
              const t = pvx * ux + pvy * uy;
              const sx = prev.nx * W + ux * t;
              const sy = prev.ny * H + uy * t;
              nx = clamp01(sx / W);
              ny = clamp01(sy / H);
            }
          }
        }
        next = start.map((p, i) => (i === index ? { nx, ny } : p));

      }
      onEditorPointsChange(next);
    };
    const up = (ev: PointerEvent) => {
      try { targetEl.releasePointerCapture(ev.pointerId); } catch { /* */ }
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!moved && index !== null) {
        // A click (no drag) on a vertex removes it, as long as the polygon
        // keeps at least a triangle. Otherwise it just becomes selected.
        if (start.length > 3) {
          onEditorPointsChange(start.filter((_, i) => i !== index));
          setSelectedVertex(null);
        } else {
          setSelectedVertex(index);
        }
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /** Split the edge after `index` by inserting its midpoint, then drag it. */
  const startMidpointDrag = (
    e: ReactPointerEvent<Element>,
    index: number,
  ) => {
    if (!polyPoints || !onEditorPointsChange) return;
    e.stopPropagation();
    e.preventDefault();
    const a = polyPoints[index];
    const b = polyPoints[(index + 1) % polyPoints.length];
    const mid = { nx: (a.nx + b.nx) / 2, ny: (a.ny + b.ny) / 2 };
    const next = [
      ...polyPoints.slice(0, index + 1),
      mid,
      ...polyPoints.slice(index + 1),
    ];
    onEditorPointsChange(next);
    setSelectedVertex(index + 1);
  };

  /** Drag a whole edge perpendicular to itself (H or V depending on slope). */
  const startEdgeDrag = (e: ReactPointerEvent<Element>, index: number) => {
    if (!polyPoints || !onEditorPointsChange) return;
    e.stopPropagation();
    e.preventDefault();
    const targetEl = e.currentTarget as Element;
    try { targetEl.setPointerCapture(e.pointerId); } catch { /* */ }
    const surface = targetEl.closest("[data-doc-surface]") as HTMLElement | null;
    const surfRect = surface?.getBoundingClientRect();
    if (!surfRect) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const start = polyPoints.map((p) => ({ ...p }));
    const i = index;
    const j = (index + 1) % start.length;
    // Edge more vertical -> move horizontally, else vertically.
    const vertical =
      Math.abs(start[j].nx - start[i].nx) * pageSize.width <
      Math.abs(start[j].ny - start[i].ny) * pageSize.height;

    const move = (ev: PointerEvent) => {
      const dxN = (ev.clientX - startX) / surfRect.width;
      const dyN = (ev.clientY - startY) / surfRect.height;
      const next = start.map((p, k) => {
        if (k !== i && k !== j) return p;
        return vertical
          ? { nx: clamp01(p.nx + dxN), ny: p.ny }
          : { nx: p.nx, ny: clamp01(p.ny + dyN) };
      });
      onEditorPointsChange(next);
    };
    const up = (ev: PointerEvent) => {
      try { targetEl.releasePointerCapture(ev.pointerId); } catch { /* */ }
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Delete / Backspace removes the selected vertex (never below a triangle).
  useEffect(() => {
    if (selectedVertex === null || !polyPoints || !onEditorPointsChange) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Delete" && ev.key !== "Backspace") return;
      const target = ev.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      if (polyPoints.length <= 3) return;
      ev.preventDefault();
      onEditorPointsChange(polyPoints.filter((_, i) => i !== selectedVertex));
      setSelectedVertex(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedVertex, polyPoints, onEditorPointsChange]);

  const renderPolygonEditor = () => {
    if (!polyPoints) return null;
    const s = Math.max(0.0001, viewScale || 1);
    const strokePxPage = 2 / s;
    const edgeColor = editorColor || "hsl(var(--primary))";
    // Handles keep a constant on-screen size, and their pointer hit area is
    // padded out to ~18px so they stay easy to grab on touch devices.
    const vertexPx = 10 / s;
    const hitPx = 18 / s;
    const px = polyPoints.map((p) => ({
      x: p.nx * pageSize.width,
      y: p.ny * pageSize.height,
    }));
    const pointsAttr = px.map((p) => `${p.x},${p.y}`).join(" ");
    return (
      <div
        className="absolute"
        style={{ left: 0, top: 0, width: pageSize.width, height: pageSize.height, pointerEvents: "none" }}
      >
        <svg
          width={pageSize.width}
          height={pageSize.height}
          style={{ position: "absolute", inset: 0, overflow: "visible", pointerEvents: "none" }}
        >
          <polygon
            points={pointsAttr}
            fill="transparent"
            stroke={edgeColor}
            strokeWidth={strokePxPage}
            strokeDasharray={`${6 / s} ${4 / s}`}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            style={{ vectorEffect: "non-scaling-stroke", strokeWidth: strokePxPage, pointerEvents: "auto", cursor: "move" }}
            onPointerDown={(e) => startPolygonDrag(e, null)}
          />
          {/* Edge hit lines - drag to move the whole edge. */}
          {px.map((p, i) => {
            const b = px[(i + 1) % px.length];
            const vertical =
              Math.abs(b.x - p.x) < Math.abs(b.y - p.y);
            return (
              <line
                key={`edge-${i}`}
                x1={p.x}
                y1={p.y}
                x2={b.x}
                y2={b.y}
                stroke="transparent"
                strokeWidth={12 / s}
                strokeLinecap="butt"
                style={{
                  pointerEvents: "stroke",
                  cursor: vertical ? "ew-resize" : "ns-resize",
                }}
                onPointerDown={(e) => startEdgeDrag(e, i)}
              />
            );
          })}
        </svg>


        {/* Midpoint ghost handles - click/drag to split the edge. */}
        {px.map((p, i) => {
          const b = px[(i + 1) % px.length];
          const mx = (p.x + b.x) / 2;
          const my = (p.y + b.y) / 2;
          return (
            <div
              key={`mid-${i}`}
              onPointerDown={(e) => startMidpointDrag(e, i)}
              title="Add point"
              style={{
                position: "absolute",
                left: mx - hitPx / 2,
                top: my - hitPx / 2,
                width: hitPx,
                height: hitPx,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                pointerEvents: "auto",
                cursor: "copy",
              }}
            >
              <div
                style={{
                  width: vertexPx * 0.75,
                  height: vertexPx * 0.75,
                  borderRadius: "50%",
                  backgroundColor: "white",
                  border: `${1 / s}px solid ${edgeColor}`,
                  opacity: 0.7,
                  boxSizing: "border-box",
                }}
              />
            </div>
          );
        })}

        {/* Vertex handles - drag to move, click to delete. */}
        {px.map((p, i) => (
          <div
            key={`vtx-${i}`}
            onPointerDown={(e) => startPolygonDrag(e, i)}
            title={polyPoints.length > 3 ? "Drag to move, click to delete" : "Drag to move"}
            style={{
              position: "absolute",
              left: p.x - hitPx / 2,
              top: p.y - hitPx / 2,
              width: hitPx,
              height: hitPx,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "auto",
              cursor: "grab",
            }}
            onPointerUpCapture={(e) => (e.currentTarget.style.cursor = "grab")}
            onPointerDownCapture={(e) => (e.currentTarget.style.cursor = "grabbing")}
          >
            <div
              style={{
                width: vertexPx,
                height: vertexPx,
                borderRadius: 2,
                backgroundColor: selectedVertex === i ? "white" : edgeColor,
                border: `${1 / s}px solid ${selectedVertex === i ? edgeColor : "white"}`,
                boxSizing: "border-box",
              }}
            />
          </div>
        ))}
      </div>
    );
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
    const strokePxPage = 2 / Math.max(0.0001, viewScale || 1);
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
            backgroundColor: "transparent",
            cursor: HANDLE_CURSORS.move,
            pointerEvents: "auto",
            boxSizing: "border-box",
            boxShadow: "0 0 0 1px rgba(255,255,255,0.9)",
          }}
        >
          <svg
            width={width}
            height={height}
            style={{ position: "absolute", inset: 0, overflow: "visible", pointerEvents: "none" }}
          >
            <rect
              x={strokePxPage / 2}
              y={strokePxPage / 2}
              width={Math.max(0, width - strokePxPage)}
              height={Math.max(0, height - strokePxPage)}
              fill="none"
              stroke={edgeColor}
              strokeWidth={strokePxPage}
              strokeDasharray={`${6 / Math.max(0.0001, viewScale || 1)} ${4 / Math.max(0.0001, viewScale || 1)}`}
              vectorEffect="non-scaling-stroke"
              style={{ vectorEffect: "non-scaling-stroke", strokeWidth: strokePxPage }}
            />
          </svg>
        </div>
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
      {(() => {
        // When rotated 90/270, the underlying image is rendered at its native
        // (unrotated) aspect and CSS-rotated inside the rotated outer box.
        const swapped = rotation === 90 || rotation === 270;
        const innerW = swapped ? pageSize.height : pageSize.width;
        const innerH = swapped ? pageSize.width : pageSize.height;
        const left = (pageSize.width - innerW) / 2;
        const top = (pageSize.height - innerH) / 2;
        return (
          <img
            ref={imgRef}
            className="pdf-canvas-element"
            src={imageUrl}
            draggable={false}
            style={{
              position: "absolute",
              left,
              top,
              width: innerW,
              height: innerH,
              maxWidth: "none",
              maxHeight: "none",
              display: "block",
              pointerEvents: "none",
              transform: rotation ? `rotate(${rotation}deg)` : undefined,
              transformOrigin: "center center",
            }}
          />
        );
      })()}

      {overlays && overlays.length > 0 && (
        <OverlayLayer
          overlays={overlays}
          pageSize={pageSize}
          hoveredId={hoveredOverlayId}
          viewScale={viewScale}
          onOverlayClick={onOverlayClick}
          onOverlayDrag={onOverlayDrag}
          syncPlacement={syncPlacement}
          onPlacingChange={onPlacingChange}
        />
      )}
      {polyPoints ? renderPolygonEditor() : renderEditor()}
    </div>
  );
};
