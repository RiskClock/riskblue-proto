import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  TransformWrapper,
  TransformComponent,
  type ReactZoomPanPinchRef,
} from "react-zoom-pan-pinch";
import { Loader2, AlertCircle } from "lucide-react";
import { DocumentSurface } from "./DocumentSurface";
import { ViewerToolbar } from "./ViewerToolbar";
import { useDocumentSource, type DocumentSourceDescriptor } from "./hooks/useDocumentSource";
import { usePdfPageRaster, type RasterPage } from "./hooks/usePdfPageRaster";
import { useFitToSelection } from "./hooks/useFitToSelection";
import {
  computeFitToRect,
  toNormalizedRect,
  type NormalizedOverlay,
  type OverlayInput,
} from "./viewerGeometry";

export type ViewerLayout = "single-page" | "stacked-pages";

export interface DrawingViewerApi {
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
  fitPage: () => void;
  fitToOverlay: (overlayId: string, opts?: { paddingRatio?: number; maxScale?: number; animate?: boolean }) => void;
}

export interface DrawingViewerProps {
  source: DocumentSourceDescriptor | null;
  layout?: ViewerLayout; // default 'single-page'
  page?: number; // single-page mode
  onPageChange?: (p: number) => void;
  overlays?: OverlayInput[];
  /** id of an overlay to auto-fit on first render. */
  initialFit?: "page" | "selection" | "actual";
  initialFitOverlayId?: string;
  hoveredOverlayId?: string | null;
  minScale?: number;
  maxScale?: number;
  showToolbar?: boolean;
  toolbarSlot?: "top" | "external";
  /** When toolbarSlot === 'external', callbacks are exposed via onApiReady. */
  onApiReady?: (api: DrawingViewerApi) => void;
  onTotalPagesChange?: (n: number) => void;
  className?: string;
}

const DEFAULT_MIN = 0.5;
const DEFAULT_MAX = 8;

export const DrawingViewer = forwardRef<DrawingViewerApi, DrawingViewerProps>(
  function DrawingViewer(
    {
      source,
      layout = "single-page",
      page = 1,
      onPageChange,
      overlays = [],
      initialFit = "page",
      initialFitOverlayId,
      hoveredOverlayId,
      minScale = DEFAULT_MIN,
      maxScale = DEFAULT_MAX,
      showToolbar = true,
      toolbarSlot = "top",
      onApiReady,
      onTotalPagesChange,
      className,
    },
    ref
  ) {
    const wrapperRef = useRef<ReactZoomPanPinchRef>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [scale, setScale] = useState(1);
    const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
    const fitOnceRef = useRef(false);

    const { resolved, loading: srcLoading, error: srcError } =
      useDocumentSource(source);

    const isPdf = resolved?.kind === "pdf";
    const { pages, loading: pdfLoading, error: pdfError, scheduleReraster } =
      usePdfPageRaster(isPdf ? resolved!.pdfBlob! : null);

    // Image source synthesizes a single "page" so the same render path works.
    const [imagePage, setImagePage] = useState<RasterPage | null>(null);
    useEffect(() => {
      if (resolved?.kind !== "image" || !resolved.imageUrl) {
        setImagePage(null);
        return;
      }
      const img = new Image();
      img.onload = () => {
        setImagePage({
          pageNum: 1,
          imageUrl: resolved.imageUrl!,
          pixelSize: { w: img.naturalWidth, h: img.naturalHeight },
          pdfSize: { w: img.naturalWidth, h: img.naturalHeight },
          // viewport is unused for image overlays
          viewport: undefined as any,
        });
      };
      img.src = resolved.imageUrl;
    }, [resolved]);

    const allPages: RasterPage[] = isPdf ? pages : imagePage ? [imagePage] : [];
    const totalPages = allPages.length;

    useEffect(() => {
      onTotalPagesChange?.(totalPages);
    }, [totalPages, onTotalPagesChange]);

    // Track viewport size for fit calculations
    useLayoutEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      const ro = new ResizeObserver(() => {
        setViewportSize({
          width: el.clientWidth,
          height: el.clientHeight,
        });
      });
      ro.observe(el);
      setViewportSize({ width: el.clientWidth, height: el.clientHeight });
      return () => ro.disconnect();
    }, []);

    // Compute CSS page size: fit to viewport for the active page (single-page mode),
    // or natural pdfSize (stacked mode lets pages flow vertically).
    const activePage =
      layout === "single-page"
        ? allPages.find((p) => p.pageNum === page) ?? allPages[0]
        : allPages[0];

    const pageCssSize = useMemo(() => {
      if (!activePage || viewportSize.width === 0 || viewportSize.height === 0) {
        return { width: 0, height: 0 };
      }
      const pad = 16;
      const cw = Math.max(1, viewportSize.width - pad * 2);
      const ch = Math.max(1, viewportSize.height - pad * 2);
      const aspect = activePage.pdfSize.w / activePage.pdfSize.h;
      const cAspect = cw / ch;
      if (aspect > cAspect) {
        return { width: cw, height: cw / aspect };
      }
      return { width: ch * aspect, height: ch };
    }, [activePage, viewportSize]);

    // Normalize overlays for the active page (single-page) or all pages (stacked).
    const normalizedByPage = useMemo(() => {
      const byPage = new Map<number, NormalizedOverlay[]>();
      for (const ov of overlays) {
        const p = allPages.find((pg) => pg.pageNum === (ov.page ?? 1));
        if (!p) continue;
        // Inject pixelSize/pdfViewport when caller didn't supply them.
        const enriched: OverlayInput = {
          ...ov,
          pixelSize: ov.pixelSize ?? p.pixelSize,
          pdfViewport: ov.pdfViewport ?? p.viewport,
        };
        const rect = toNormalizedRect(enriched);
        if (!rect) continue;
        const arr = byPage.get(p.pageNum) ?? [];
        arr.push({
          id: ov.id,
          page: p.pageNum,
          rect,
          color: ov.color,
          label: ov.label,
        });
        byPage.set(p.pageNum, arr);
      }
      return byPage;
    }, [overlays, allPages]);

    // Adaptive reraster on settle (panning/zooming stop) — and track scale via onTransform.
    const handleTransform = (
      _ref: ReactZoomPanPinchRef,
      state: { scale: number; positionX: number; positionY: number }
    ) => {
      setScale(state.scale);
    };
    const handleSettle = (ref: ReactZoomPanPinchRef) => {
      const s = ref.state.scale;
      if (isPdf && activePage) {
        scheduleReraster(activePage.pageNum, s);
      }
    };

    // Fit-to-selection
    const fitToOverlay = useFitToSelection(wrapperRef);

    /**
     * Positioning model:
     *
     * The page surface is anchored at (0, 0) inside TransformComponent — we do
     * NOT use flex centering on the transformed content. All positioning is
     * owned by the transform (positionX, positionY, scale). This keeps a single
     * coordinate model so computeFitToRect is deterministic for BOTH fit-page
     * and fit-to-selection. (Previously flex centering double-counted offsets
     * and shifted selection fits off-target.)
     */
    const fitPage = () => {
      const w = wrapperRef.current;
      if (!w || pageCssSize.width === 0) return;
      const target = computeFitToRect({
        rect: { nx: 0, ny: 0, nw: 1, nh: 1 },
        pageSize: pageCssSize,
        viewportSize,
        paddingRatio: 0,
        minScale,
        maxScale,
      });
      w.setTransform(target.positionX, target.positionY, target.scale, 250);
    };

    const doFitOverlay = (
      overlayId: string,
      opts?: { paddingRatio?: number; maxScale?: number; animate?: boolean }
    ) => {
      const list = normalizedByPage.get(activePage?.pageNum ?? 1) ?? [];
      const target = list.find((o) => o.id === overlayId);
      if (!target || pageCssSize.width === 0) return;
      fitToOverlay(target.rect, pageCssSize, viewportSize, {
        paddingRatio: opts?.paddingRatio ?? 0.2,
        minScale,
        maxScale: opts?.maxScale ?? Math.min(maxScale, 4),
        animate: opts?.animate,
      });
    };

    // initialFit handling — fires once after layout is ready
    useEffect(() => {
      if (fitOnceRef.current) return;
      if (!activePage || pageCssSize.width === 0 || viewportSize.width === 0) return;
      if (initialFit === "selection" && initialFitOverlayId) {
        doFitOverlay(initialFitOverlayId);
        fitOnceRef.current = true;
      } else if (initialFit === "page") {
        fitPage();
        fitOnceRef.current = true;
      } else if (initialFit === "actual") {
        wrapperRef.current?.setTransform(0, 0, 1, 0);
        fitOnceRef.current = true;
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activePage, pageCssSize.width, pageCssSize.height, viewportSize.width, viewportSize.height, initialFit, initialFitOverlayId]);

    // Imperative API. Depend on primitive scalars so the object identity is
    // stable across renders that don't actually change layout (avoids
    // re-running consumer effects keyed on the api). `reset` returns to the
    // default fit-page view (the intended default for this viewer).
    const api: DrawingViewerApi = useMemo(
      () => ({
        zoomIn: () => wrapperRef.current?.zoomIn(),
        zoomOut: () => wrapperRef.current?.zoomOut(),
        reset: fitPage,
        fitPage,
        fitToOverlay: doFitOverlay,
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [pageCssSize.width, pageCssSize.height, activePage?.pageNum, viewportSize.width, viewportSize.height]
    );
    useImperativeHandle(ref, () => api, [api]);
    useEffect(() => {
      onApiReady?.(api);
    }, [api, onApiReady]);

    const loading = srcLoading || pdfLoading;
    const error = srcError || pdfError;

    return (
      <div className={`flex flex-col h-full min-h-0 ${className ?? ""}`}>
        {showToolbar && toolbarSlot === "top" && (
          <div className="flex items-center justify-end gap-2 p-2 border-b">
            <ViewerToolbar
              scale={scale}
              minScale={minScale}
              maxScale={maxScale}
              onZoomIn={api.zoomIn}
              onZoomOut={api.zoomOut}
              onReset={api.reset}
              onFitPage={api.fitPage}
              onFitSelection={
                initialFitOverlayId
                  ? () => doFitOverlay(initialFitOverlayId)
                  : undefined
              }
              pageNav={
                layout === "single-page" && totalPages > 1
                  ? {
                      current: page,
                      total: totalPages,
                      onPrev: () => onPageChange?.(Math.max(1, page - 1)),
                      onNext: () =>
                        onPageChange?.(Math.min(totalPages, page + 1)),
                    }
                  : undefined
              }
            />
          </div>
        )}
        <div
          ref={containerRef}
          className="relative flex-1 min-h-0 overflow-hidden bg-muted/30"
        >
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center space-y-2">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground mx-auto" />
                <p className="text-sm text-muted-foreground">Loading...</p>
              </div>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center space-y-2">
                <AlertCircle className="w-8 h-8 text-destructive mx-auto" />
                <p className="text-sm text-destructive">{error}</p>
              </div>
            </div>
          ) : activePage && pageCssSize.width > 0 ? (
            <TransformWrapper
              ref={wrapperRef}
              minScale={minScale}
              maxScale={maxScale}
              limitToBounds={false}
              centerOnInit
              wheel={{ step: 0.15 }}
              doubleClick={{ disabled: false, step: 0.5 }}
              pinch={{ step: 5 }}
              panning={{ velocityDisabled: true }}
              onTransform={handleTransform}
              onZoomStop={handleSettle}
              onPanningStop={handleSettle}
              onWheelStop={handleSettle}
              onPinchStop={handleSettle}
            >
              <TransformComponent
                wrapperStyle={{ width: "100%", height: "100%" }}
                contentStyle={{
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  alignItems: layout === "stacked-pages" ? "flex-start" : "center",
                  justifyContent: "center",
                }}
              >
                {layout === "single-page" ? (
                  <DocumentSurface
                    imageUrl={activePage.imageUrl}
                    pageSize={pageCssSize}
                    overlays={normalizedByPage.get(activePage.pageNum) ?? []}
                    hoveredOverlayId={hoveredOverlayId}
                  />
                ) : (
                  <div className="flex flex-col items-center gap-4">
                    {allPages.map((p) => {
                      // For stacked layout, size each page based on viewport width
                      const aspect = p.pdfSize.w / p.pdfSize.h;
                      const w = Math.max(1, viewportSize.width - 32);
                      const h = w / aspect;
                      return (
                        <DocumentSurface
                          key={p.pageNum}
                          imageUrl={p.imageUrl}
                          pageSize={{ width: w, height: h }}
                          overlays={normalizedByPage.get(p.pageNum) ?? []}
                          hoveredOverlayId={hoveredOverlayId}
                        />
                      );
                    })}
                  </div>
                )}
              </TransformComponent>
            </TransformWrapper>
          ) : null}
        </div>
      </div>
    );
  }
);
