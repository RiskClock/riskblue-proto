export { DrawingViewer } from "./DrawingViewer";
export type { DrawingViewerApi, DrawingViewerProps, ViewerLayout } from "./DrawingViewer";
export { ViewerToolbar } from "./ViewerToolbar";
export { DocumentSurface } from "./DocumentSurface";
export { OverlayLayer } from "./OverlayLayer";
export type {
  CoordSpace,
  BBoxArray,
  NormalizedRect,
  OverlayInput,
  NormalizedOverlay,
  FitTarget,
} from "./viewerGeometry";
export {
  toNormalizedRect,
  computeFitToRect,
} from "./viewerGeometry";
export type { DocumentSourceDescriptor, ResolvedSource } from "./hooks/useDocumentSource";
export { useDocumentSource } from "./hooks/useDocumentSource";
export { usePdfPageRaster } from "./hooks/usePdfPageRaster";
export { useFitToSelection } from "./hooks/useFitToSelection";
