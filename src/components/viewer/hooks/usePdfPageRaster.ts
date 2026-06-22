import { useCallback, useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

export interface RasterPage {
  pageNum: number;
  /** Rendered raster as an object URL (image/jpeg blob). */
  imageUrl: string;
  /** Raster pixel size (the canvas the image was drawn from). */
  pixelSize: { w: number; h: number };
  /** PDF user-space size (points), used for coordinate normalization. */
  pdfSize: { w: number; h: number };
  /** The viewport used to render this raster. Useful for pdf-point overlays. */
  viewport: pdfjsLib.PageViewport;
}

export interface PdfRasterOptions {
  /** Base scale for the initial raster. */
  baseScale?: number;
  /** Maximum effective DPR cap when reraster runs. */
  maxDpr?: number;
  /** Maximum total pixels per page raster (safety cap). */
  maxPixelsPerPage?: number;
  /** Settle delay before reraster. */
  settleMs?: number;
  /** Reraster only when CSS scale exceeds this. */
  rerasterAboveScale?: number;
  /** Currently-visible page (1-indexed). Only this page + buffer are rasterized. */
  activePage?: number;
  /** How many pages before/after the active page to pre-rasterize. */
  bufferPages?: number;
  /** When true, rasterize every page eagerly (use for stacked layout). */
  eager?: boolean;
  /** JPEG quality for the blob encode (0..1). */
  jpegQuality?: number;
}

const DEFAULTS: Required<Omit<PdfRasterOptions, "activePage">> = {
  baseScale: 1,
  maxDpr: 3,
  maxPixelsPerPage: 16_000_000, // 16 Mpx
  settleMs: 250,
  rerasterAboveScale: 2.5,
  bufferPages: 1,
  eager: false,
  jpegQuality: 0.85,
};

// Module-level cache for the parsed PDFDocumentProxy, keyed by Blob identity.
// Rasterized pages are NOT cached at module level anymore — they hold object
// URLs whose lifetime is tied to the hook instance.
const pdfDocCache = new WeakMap<Blob, Promise<pdfjsLib.PDFDocumentProxy>>();

const encodeCanvasToObjectUrl = (
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<string> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("canvas.toBlob returned null"));
          return;
        }
        resolve(URL.createObjectURL(blob));
      },
      "image/jpeg",
      quality,
    );
  });

/**
 * Loads a PDF blob/array buffer and rasterizes pages on demand.
 *
 * - Only the active page (+/- `bufferPages`) is rasterized unless `eager` is
 *   set. Pages outside the window stay un-rasterized.
 * - Switching `activePage` cancels in-flight render tasks for pages that fell
 *   out of the window so the main thread isn't blocked by stale work.
 * - Encodes via `canvas.toBlob('image/jpeg')` + `URL.createObjectURL` to avoid
 *   the synchronous base64 cost of `canvas.toDataURL`.
 */
export function usePdfPageRaster(
  source: ArrayBuffer | Blob | null,
  options: PdfRasterOptions = {},
) {
  const opts = { ...DEFAULTS, ...options };
  const activePage = options.activePage ?? 1;

  const [pages, setPages] = useState<RasterPage[]>([]);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pdfRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const rerasterTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  // pageNum -> render task we can cancel when the active window shifts.
  const renderTasks = useRef<Map<number, { cancel: () => void }>>(new Map());
  // pageNum -> in-flight raster promise so we don't double-schedule.
  const inFlight = useRef<Set<number>>(new Set());
  // All object URLs we've handed out (for cleanup).
  const objectUrls = useRef<Set<string>>(new Set());

  const releaseObjectUrl = useCallback((url: string | undefined) => {
    if (!url || !objectUrls.current.has(url)) return;
    URL.revokeObjectURL(url);
    objectUrls.current.delete(url);
  }, []);

  // --- Document load --------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    if (!source) {
      setPages([]);
      setTotalPages(0);
      return;
    }

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const blobKey = source instanceof Blob ? source : null;
        let pdfPromise: Promise<pdfjsLib.PDFDocumentProxy> | undefined =
          blobKey ? pdfDocCache.get(blobKey) : undefined;
        if (!pdfPromise) {
          const data =
            source instanceof Blob ? await source.arrayBuffer() : source;
          pdfPromise = pdfjsLib.getDocument({ data }).promise;
          if (blobKey) pdfDocCache.set(blobKey, pdfPromise);
        }
        const pdf = await pdfPromise;
        if (cancelled) return;
        pdfRef.current = pdf;
        setTotalPages(pdf.numPages);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    setPages([]);
    setTotalPages(0);
    load();

    return () => {
      cancelled = true;
      // Cancel timers and any in-flight render tasks for this document.
      rerasterTimers.current.forEach((t) => clearTimeout(t));
      rerasterTimers.current.clear();
      renderTasks.current.forEach((task) => {
        try { task.cancel(); } catch { /* noop */ }
      });
      renderTasks.current.clear();
      inFlight.current.clear();
      // Revoke every object URL we created.
      objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
      objectUrls.current.clear();
    };
  }, [source]);

  // --- Lazy rasterization of pages within the active window -----------------
  useEffect(() => {
    const pdf = pdfRef.current;
    if (!pdf || totalPages === 0) return;

    const wanted = new Set<number>();
    if (opts.eager) {
      for (let i = 1; i <= totalPages; i++) wanted.add(i);
    } else {
      const start = Math.max(1, activePage - opts.bufferPages);
      const end = Math.min(totalPages, activePage + opts.bufferPages);
      for (let i = start; i <= end; i++) wanted.add(i);
    }

    // Cancel in-flight renders that are no longer wanted.
    renderTasks.current.forEach((task, pageNum) => {
      if (!wanted.has(pageNum)) {
        try { task.cancel(); } catch { /* noop */ }
        renderTasks.current.delete(pageNum);
        inFlight.current.delete(pageNum);
      }
    });

    let cancelled = false;

    const renderPage = async (pageNum: number) => {
      if (inFlight.current.has(pageNum)) return;
      // Already rasterized? skip.
      if (pages.some((p) => p.pageNum === pageNum)) return;
      inFlight.current.add(pageNum);
      try {
        const page = await pdf.getPage(pageNum);
        if (cancelled || !wanted.has(pageNum)) return;
        const baseViewport = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: opts.baseScale });

        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d")!;
        const task = page.render({
          canvasContext: ctx,
          viewport,
          canvas,
        } as any);
        renderTasks.current.set(pageNum, task);
        try {
          await task.promise;
        } finally {
          renderTasks.current.delete(pageNum);
        }
        if (cancelled || !wanted.has(pageNum)) return;

        const imageUrl = await encodeCanvasToObjectUrl(canvas, opts.jpegQuality);
        if (cancelled || !wanted.has(pageNum)) {
          URL.revokeObjectURL(imageUrl);
          return;
        }
        objectUrls.current.add(imageUrl);

        const rasterPage: RasterPage = {
          pageNum,
          imageUrl,
          pixelSize: { w: viewport.width, h: viewport.height },
          pdfSize: { w: baseViewport.width, h: baseViewport.height },
          viewport,
        };
        setPages((prev) => {
          if (prev.some((p) => p.pageNum === pageNum)) {
            // Race: discard the duplicate raster.
            URL.revokeObjectURL(imageUrl);
            objectUrls.current.delete(imageUrl);
            return prev;
          }
          return [...prev, rasterPage].sort((a, b) => a.pageNum - b.pageNum);
        });
      } catch (e: any) {
        // pdf.js throws a RenderingCancelledException — silently ignore.
        if (e?.name !== "RenderingCancelledException") {
          // eslint-disable-next-line no-console
          console.warn("PDF page render failed", pageNum, e);
        }
      } finally {
        inFlight.current.delete(pageNum);
      }
    };

    // Kick off rasterization for every page in the window that we don't have.
    // Active page first, then neighbours.
    const order = Array.from(wanted).sort(
      (a, b) => Math.abs(a - activePage) - Math.abs(b - activePage),
    );
    (async () => {
      for (const pageNum of order) {
        if (cancelled) return;
        await renderPage(pageNum);
      }
    })();

    return () => {
      cancelled = true;
    };
    // We intentionally depend on totalPages (signals doc loaded), activePage,
    // and the window settings. `pages` is read inside but used only as a skip
    // guard — re-running on every page push would cause render churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalPages, activePage, opts.eager, opts.bufferPages, opts.baseScale, opts.jpegQuality]);

  /**
   * Schedule a higher-DPI reraster of a single page after the transform settles.
   * Skipped if the requested pixel count exceeds the safety budget.
   */
  const scheduleReraster = useCallback(
    (pageNum: number, cssScale: number) => {
      if (cssScale <= opts.rerasterAboveScale) return;
      const pdf = pdfRef.current;
      if (!pdf) return;

      const existing = rerasterTimers.current.get(pageNum);
      if (existing) clearTimeout(existing);

      const timer = setTimeout(async () => {
        try {
          const dpr = Math.min(window.devicePixelRatio || 1, opts.maxDpr);
          const targetScale =
            Math.min(opts.baseScale * cssScale, opts.baseScale * opts.maxDpr) *
            (dpr / (window.devicePixelRatio || 1));
          const page = await pdf.getPage(pageNum);
          const viewport = page.getViewport({ scale: targetScale });
          const totalPx = viewport.width * viewport.height;
          if (totalPx > opts.maxPixelsPerPage) return;

          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext("2d")!;
          const task = page.render({
            canvasContext: ctx,
            viewport,
            canvas,
          } as any);
          await task.promise;
          const imageUrl = await encodeCanvasToObjectUrl(canvas, opts.jpegQuality);
          objectUrls.current.add(imageUrl);

          setPages((prev) =>
            prev.map((p) => {
              if (p.pageNum !== pageNum) return p;
              releaseObjectUrl(p.imageUrl);
              return {
                ...p,
                imageUrl,
                pixelSize: { w: viewport.width, h: viewport.height },
                viewport,
              };
            }),
          );
        } catch {
          // ignore reraster errors silently
        } finally {
          rerasterTimers.current.delete(pageNum);
        }
      }, opts.settleMs);

      rerasterTimers.current.set(pageNum, timer);
    },
    [opts.baseScale, opts.jpegQuality, opts.maxDpr, opts.maxPixelsPerPage, opts.rerasterAboveScale, opts.settleMs, releaseObjectUrl],
  );

  return { pages, totalPages, loading, error, scheduleReraster };
}
