// Vector-PDF export with overlay compositing.
//
// Loads the original PDF via pdf-lib, copies the requested page(s), and
// stamps a transparent PNG (captured from the shared DrawingViewer via
// `capturePageToPng({ overlaysOnly: true })`) on top of each page.
//
// Consumers:
//   - FileViewerModal per-page Download dialog (single page)
//   - BulkDrawingDownloadModal on the workbench (all pages of many files
//     merged into one PDF).
//
// Overlay parity with the viewer is guaranteed because the overlay PNG is
// produced by the same DrawingViewer mount used on-screen — same label
// optimizer, same coordinates, same clamping.

import { PDFDocument } from "pdf-lib";
import {
  capturePageToPng,
  type CapturePageInput,
} from "@/lib/threatReportPageCapture";
import type { DocumentSourceDescriptor } from "@/components/viewer";

export interface PageOverlaySpec {
  /** 1-based page index into the source PDF. */
  page: number;
  /** Overlays for this page (may be empty if none are attached). */
  overlays: any[];
}

export interface PdfExportEntry {
  /** Human file name (used only for the source-file label / errors). */
  fileName: string;
  /** Raw source PDF bytes. */
  sourceBytes: ArrayBuffer | Uint8Array;
  /**
   * Descriptor used when we need to capture overlays for this file's pages.
   * Must resolve to the SAME PDF as `sourceBytes` (both come from the same
   * storage row).
   */
  source: DocumentSourceDescriptor;
  /** Pages to include, in output order. */
  pages: PageOverlaySpec[];
}

export interface BuildPdfOptions {
  /**
   * When false, produce a plain merged vector PDF with no overlay stamp.
   * When true (default), each page is composited with an overlay PNG.
   */
  includeOverlays?: boolean;
  /** Optional progress callback: (completedPages, totalPages). */
  onProgress?: (done: number, total: number) => void;
}

/**
 * Build a merged, annotated PDF from one or more source PDFs.
 * Returns the merged PDF bytes.
 */
export async function buildAnnotatedPdf(
  entries: PdfExportEntry[],
  opts: BuildPdfOptions = {},
): Promise<Uint8Array> {
  const includeOverlays = opts.includeOverlays !== false;
  const totalPages = entries.reduce((s, e) => s + e.pages.length, 0);
  let done = 0;

  const out = await PDFDocument.create();

  for (const entry of entries) {
    const srcBytes =
      entry.sourceBytes instanceof Uint8Array
        ? entry.sourceBytes
        : new Uint8Array(entry.sourceBytes);
    const src = await PDFDocument.load(srcBytes, {
      ignoreEncryption: true,
    });
    const pageCount = src.getPageCount();

    for (const spec of entry.pages) {
      const idx = spec.page - 1;
      if (idx < 0 || idx >= pageCount) {
        done += 1;
        opts.onProgress?.(done, totalPages);
        continue;
      }

      const [copied] = await out.copyPages(src, [idx]);
      const addedPage = out.addPage(copied);
      const { width: pageW, height: pageH } = addedPage.getSize();

      if (includeOverlays && spec.overlays.length > 0) {
        const capture = await capturePageToPng({
          source: entry.source,
          page: spec.page,
          overlays: spec.overlays,
          overlaysOnly: true,
          // Overlay pixels are small; a modest raster keeps the resulting
          // PDF light while still looking crisp when the viewer zooms in.
          targetLongEdgePx: 2400,
        });
        if (capture) {
          const overlayBytes = await capture.blob.arrayBuffer();
          const png = await out.embedPng(new Uint8Array(overlayBytes));
          addedPage.drawImage(png, {
            x: 0,
            y: 0,
            width: pageW,
            height: pageH,
          });
        }
      }

      done += 1;
      opts.onProgress?.(done, totalPages);
    }
  }

  return await out.save();
}

/** Convenience: build + trigger a browser download. */
export function triggerPdfDownload(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes as unknown as BlobPart], {
    type: "application/pdf",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Read the page count of a PDF blob without keeping it in memory. Cheap when
 * the caller already has the bytes; otherwise a network fetch is required.
 */
export async function readPdfPageCount(
  bytes: ArrayBuffer | Uint8Array,
): Promise<number> {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const doc = await PDFDocument.load(u8, { ignoreEncryption: true });
  return doc.getPageCount();
}

// Re-export for callers that only import from this module.
export type { CapturePageInput };
