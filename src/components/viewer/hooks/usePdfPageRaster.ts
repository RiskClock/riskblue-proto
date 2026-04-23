import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

export interface RasterPage {
  pageNum: number;
  /** Rendered raster image as a data URL. */
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
}

const DEFAULTS: Required<PdfRasterOptions> = {
  baseScale: 2,
  maxDpr: 3,
  maxPixelsPerPage: 16_000_000, // 16 Mpx
  settleMs: 250,
  rerasterAboveScale: 2.5,
};

/**
 * Loads a PDF blob/array buffer and renders all pages at a base scale.
 * Provides a `rerasterPage(pageNum, cssScale)` callback to upgrade a single
 * page after transform settle. Skips reraster if requested resolution would
 * exceed the per-page pixel budget.
 */
export function usePdfPageRaster(
  source: ArrayBuffer | Blob | null,
  options: PdfRasterOptions = {}
) {
  const opts = { ...DEFAULTS, ...options };
  const [pages, setPages] = useState<RasterPage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pdfRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const rerasterTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    let cancelled = false;
    if (!source) {
      setPages([]);
      return;
    }

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data =
          source instanceof Blob ? await source.arrayBuffer() : source;
        const pdf = await pdfjsLib.getDocument({ data }).promise;
        pdfRef.current = pdf;

        const out: RasterPage[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const baseViewport = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: opts.baseScale });

          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext("2d")!;
          await page.render({
            canvasContext: ctx,
            viewport,
            canvas,
          } as any).promise;

          if (cancelled) return;
          out.push({
            pageNum: i,
            imageUrl: canvas.toDataURL("image/png"),
            pixelSize: { w: viewport.width, h: viewport.height },
            pdfSize: { w: baseViewport.width, h: baseViewport.height },
            viewport,
          });
        }
        if (!cancelled) setPages(out);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
      rerasterTimers.current.forEach((t) => clearTimeout(t));
      rerasterTimers.current.clear();
    };
  }, [source, opts.baseScale]);

  /**
   * Schedule a higher-DPI reraster of a single page after the transform settles.
   * Skipped if the requested pixel count exceeds the safety budget.
   */
  const scheduleReraster = (pageNum: number, cssScale: number) => {
    if (cssScale <= opts.rerasterAboveScale) return;
    const pdf = pdfRef.current;
    if (!pdf) return;

    const existing = rerasterTimers.current.get(pageNum);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(async () => {
      try {
        const dpr = Math.min(window.devicePixelRatio || 1, opts.maxDpr);
        const targetScale = Math.min(opts.baseScale * cssScale, opts.baseScale * opts.maxDpr) * (dpr / (window.devicePixelRatio || 1));
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: targetScale });
        const totalPx = viewport.width * viewport.height;
        if (totalPx > opts.maxPixelsPerPage) {
          // Skip; would exceed budget
          return;
        }
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d")!;
        await page.render({
          canvasContext: ctx,
          viewport,
          canvas,
        } as any).promise;
        const imageUrl = canvas.toDataURL("image/png");

        setPages((prev) =>
          prev.map((p) =>
            p.pageNum === pageNum
              ? {
                  ...p,
                  imageUrl,
                  pixelSize: { w: viewport.width, h: viewport.height },
                  viewport,
                }
              : p
          )
        );
      } catch {
        // ignore reraster errors silently
      } finally {
        rerasterTimers.current.delete(pageNum);
      }
    }, opts.settleMs);

    rerasterTimers.current.set(pageNum, timer);
  };

  return { pages, loading, error, scheduleReraster };
}
