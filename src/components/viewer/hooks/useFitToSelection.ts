import { useCallback } from "react";
import type { ReactZoomPanPinchRef } from "react-zoom-pan-pinch";
import {
  computeFitToRect,
  type NormalizedRect,
} from "../viewerGeometry";

/**
 * Returns a stable fitToRect callback that uses the rzpp setTransform API.
 * Pass the wrapper ref + the page CSS size at scale 1 + the viewport size.
 */
export function useFitToSelection(
  wrapperRef: React.RefObject<ReactZoomPanPinchRef>
) {
  return useCallback(
    (
      rect: NormalizedRect,
      pageSize: { width: number; height: number },
      viewportSize: { width: number; height: number },
      opts?: { paddingRatio?: number; minScale?: number; maxScale?: number; animate?: boolean }
    ) => {
      const wrapper = wrapperRef.current;
      if (!wrapper) return;
      const target = computeFitToRect({
        rect,
        pageSize,
        viewportSize,
        paddingRatio: opts?.paddingRatio,
        minScale: opts?.minScale,
        maxScale: opts?.maxScale,
      });
      wrapper.setTransform(
        target.positionX,
        target.positionY,
        target.scale,
        opts?.animate === false ? 0 : 250
      );
    },
    [wrapperRef]
  );
}
