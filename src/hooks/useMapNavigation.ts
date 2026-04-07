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
  zoomStep = 0.1,
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
  const wheelAccum = useRef(0);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Smooth animated zoom to a target level, keeping a point anchored
  const animateZoomTo = useCallback(
    (targetZoom: number, clientX: number, clientY: number) => {
      const container = containerRef.current;
      if (!container) {
        setZoom(targetZoom);
        return;
      }

      const rect = container.getBoundingClientRect();
      const pointX = clientX - rect.left;
      const pointY = clientY - rect.top;

      // Cancel any ongoing animation
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);

      const startZoom = zoom;
      const startTime = performance.now();
      const duration = 250; // ms

      const animate = (now: number) => {
        const elapsed = now - startTime;
        const t = Math.min(1, elapsed / duration);
        // ease-out cubic
        const eased = 1 - Math.pow(1 - t, 3);
        const currentZoom = startZoom + (targetZoom - startZoom) * eased;

        // Compute anchor fraction before zoom change
        const fracX = container.scrollWidth > 0
          ? (container.scrollLeft + pointX) / container.scrollWidth : 0.5;
        const fracY = container.scrollHeight > 0
          ? (container.scrollTop + pointY) / container.scrollHeight : 0.5;

        setZoom(currentZoom);

        requestAnimationFrame(() => {
          if (!container) return;
          container.scrollLeft = fracX * container.scrollWidth - pointX;
          container.scrollTop = fracY * container.scrollHeight - pointY;
        });

        if (t < 1) {
          animFrameRef.current = requestAnimationFrame(animate);
        } else {
          animFrameRef.current = null;
        }
      };

      animFrameRef.current = requestAnimationFrame(animate);
    },
    [containerRef, setZoom, zoom]
  );

  // Instant zoom at a cursor point (used for scroll wheel)
  const zoomAtPoint = useCallback(
    (delta: number, clientX: number, clientY: number) => {
      const container = containerRef.current;
      if (!container) {
        setZoom((z) => Math.min(maxZoom, Math.max(minZoom, z + delta)));
        return;
      }
      const rect = container.getBoundingClientRect();
      const pointX = clientX - rect.left;
      const pointY = clientY - rect.top;

      // Compute the content-space coordinate under the cursor
      const contentX = container.scrollLeft + pointX;
      const contentY = container.scrollTop + pointY;

      setZoom((prev) => {
        const next = Math.min(maxZoom, Math.max(minZoom, prev + delta));
        const scale = next / prev;

        requestAnimationFrame(() => {
          if (!container) return;
          // After zoom, the same content point should remain under the cursor
          container.scrollLeft = contentX * scale - pointX;
          container.scrollTop = contentY * scale - pointY;
        });
        return next;
      });
    },
    [containerRef, setZoom, minZoom, maxZoom]
  );

  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      e.preventDefault();

      let delta: number;
      if (e.ctrlKey) {
        // Trackpad pinch — use small continuous delta
        delta = -e.deltaY * 0.005;
      } else {
        // Mouse wheel — normalize to small steps for smoothness
        delta = e.deltaY < 0 ? zoomStep : -zoomStep;
      }

      zoomAtPoint(delta, e.clientX, e.clientY);
    },
    [zoomAtPoint, zoomStep]
  );

  const onDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      // Animated zoom in by 0.75x on double-click
      const target = Math.min(maxZoom, zoom + 0.75);
      animateZoomTo(target, e.clientX, e.clientY);
    },
    [animateZoomTo, maxZoom, zoom]
  );

  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const container = containerRef.current;
      if (!container) return;
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
        const delta = (dist - touchRef.current.lastDist) * 0.005;
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
