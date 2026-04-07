import { useRef, useCallback } from "react";

interface MapNavigationOptions {
  zoom: number;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  minZoom?: number;
  maxZoom?: number;
  zoomStep?: number;
  containerRef: React.RefObject<HTMLDivElement>;
}

export function useMapNavigation({
  zoom,
  setZoom,
  minZoom = 1,
  maxZoom = 8,
  zoomStep = 0.25,
  containerRef,
}: MapNavigationOptions) {
  const dragRef = useRef({
    isDragging: false,
    startX: 0,
    startY: 0,
    scrollLeft: 0,
    scrollTop: 0,
  });
  const touchRef = useRef({ lastDist: 0 });
  const isDraggingState = useRef(false); // for cursor style without re-render

  const zoomAtPoint = useCallback(
    (delta: number, clientX: number, clientY: number) => {
      const container = containerRef.current;
      if (!container) {
        setZoom((z) => Math.min(maxZoom, Math.max(minZoom, z + delta)));
        return;
      }
      const rect = container.getBoundingClientRect();
      const fracX =
        container.scrollWidth > 0
          ? (container.scrollLeft + (clientX - rect.left)) / container.scrollWidth
          : 0.5;
      const fracY =
        container.scrollHeight > 0
          ? (container.scrollTop + (clientY - rect.top)) / container.scrollHeight
          : 0.5;

      setZoom((prev) => {
        const next = Math.min(maxZoom, Math.max(minZoom, prev + delta));
        requestAnimationFrame(() => {
          if (!container) return;
          container.scrollLeft =
            fracX * container.scrollWidth - (clientX - rect.left);
          container.scrollTop =
            fracY * container.scrollHeight - (clientY - rect.top);
        });
        return next;
      });
    },
    [containerRef, setZoom, minZoom, maxZoom]
  );

  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      e.preventDefault();
      const delta = e.ctrlKey
        ? -e.deltaY * 0.01 // trackpad pinch
        : e.deltaY < 0
        ? zoomStep
        : -zoomStep;
      zoomAtPoint(delta, e.clientX, e.clientY);
    },
    [zoomAtPoint, zoomStep]
  );

  const onDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      zoomAtPoint(0.5, e.clientX, e.clientY);
    },
    [zoomAtPoint]
  );

  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Only pan with left button
      if (e.button !== 0) return;
      const container = containerRef.current;
      if (!container) return;
      isDraggingState.current = true;
      container.style.cursor = "grabbing";
      dragRef.current = {
        isDragging: true,
        startX: e.pageX,
        startY: e.pageY,
        scrollLeft: container.scrollLeft,
        scrollTop: container.scrollTop,
      };
    },
    [containerRef]
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!dragRef.current.isDragging) return;
      e.preventDefault();
      const container = containerRef.current;
      if (!container) return;
      const dx = e.pageX - dragRef.current.startX;
      const dy = e.pageY - dragRef.current.startY;
      container.scrollLeft = dragRef.current.scrollLeft - dx;
      container.scrollTop = dragRef.current.scrollTop - dy;
    },
    [containerRef]
  );

  const stopDrag = useCallback(() => {
    dragRef.current.isDragging = false;
    isDraggingState.current = false;
    const container = containerRef.current;
    if (container) container.style.cursor = "grab";
  }, [containerRef]);

  const onMouseUp = stopDrag;
  const onMouseLeave = stopDrag;

  const onTouchStart = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        touchRef.current.lastDist = Math.hypot(dx, dy);
      } else if (e.touches.length === 1) {
        const container = containerRef.current;
        if (!container) return;
        dragRef.current = {
          isDragging: true,
          startX: e.touches[0].pageX,
          startY: e.touches[0].pageY,
          scrollLeft: container.scrollLeft,
          scrollTop: container.scrollTop,
        };
      }
    },
    [containerRef]
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        const delta = (dist - touchRef.current.lastDist) * 0.01;
        touchRef.current.lastDist = dist;
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        zoomAtPoint(delta, midX, midY);
      } else if (e.touches.length === 1 && dragRef.current.isDragging) {
        const container = containerRef.current;
        if (!container) return;
        const dx = e.touches[0].pageX - dragRef.current.startX;
        const dy = e.touches[0].pageY - dragRef.current.startY;
        container.scrollLeft = dragRef.current.scrollLeft - dx;
        container.scrollTop = dragRef.current.scrollTop - dy;
      }
    },
    [containerRef, zoomAtPoint]
  );

  const onTouchEnd = useCallback(() => {
    dragRef.current.isDragging = false;
  }, []);

  return {
    handlers: {
      onWheel,
      onDoubleClick,
      onMouseDown,
      onMouseMove,
      onMouseUp,
      onMouseLeave,
      onTouchStart,
      onTouchMove,
      onTouchEnd,
    },
    containerStyle: { cursor: "grab" } as React.CSSProperties,
  };
}
