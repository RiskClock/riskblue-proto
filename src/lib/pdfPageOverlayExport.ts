// Vector-PDF export with overlay compositing.
//
// Loads the original PDF via pdf-lib, embeds each requested page as a Form
// XObject, and re-draws it upright onto a fresh page of the display size
// (baking any page /Rotate). A transparent overlay PNG is then stamped on
// top at the same display dimensions.
//
// Baking rotation into the output means:
//   • The output PDF opens looking identical to the source PDF (same
//     orientation, same content).
//   • Overlays captured in display orientation can be drawn at (0, 0) with
//     display dimensions, without any per-rotation coordinate math.
//
// Consumers:
//   - FileViewerModal per-page Download dialog (single page)
//   - BulkDrawingDownloadModal on the workbench (all pages of many files
//     merged into one PDF).

import { PDFDocument, degrees } from "pdf-lib";
import { captureOverlayOnly } from "@/lib/overlayOnlyCapture";
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
   * Descriptor kept for API compatibility; no longer required by the
   * overlay-capture step (which uses OverlayLayer directly).
   */
  source?: DocumentSourceDescriptor;
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

      const srcPage = src.getPage(idx);
      const rot = (srcPage.getRotation().angle % 360 + 360) % 360;
      const { width: mW, height: mH } = srcPage.getSize();
      // Display dimensions after applying the page /Rotate.
      const dispW = rot % 180 === 0 ? mW : mH;
      const dispH = rot % 180 === 0 ? mH : mW;

      // Embed the source page as a Form XObject, then draw it (rotated so
      // that after baking the rotation is 0) onto a new upright page.
      const [embedded] = await out.embedPages([srcPage]);
      const newPage = out.addPage([dispW, dispH]);
      let ox = 0;
      let oy = 0;
      if (rot === 90) { ox = 0; oy = mW; }
      else if (rot === 180) { ox = mW; oy = mH; }
      else if (rot === 270) { ox = mH; oy = 0; }
      newPage.drawPage(embedded, {
        x: ox,
        y: oy,
        rotate: degrees(rot),
      });

      if (includeOverlays && spec.overlays.length > 0) {
        const capture = await captureOverlayOnly({
          pageSize: { width: dispW, height: dispH },
          overlays: spec.overlays,
          outScale: 3,
        });
        if (capture) {
          const overlayBytes = await capture.blob.arrayBuffer();
          const png = await out.embedPng(new Uint8Array(overlayBytes));
          newPage.drawImage(png, {
            x: 0,
            y: 0,
            width: dispW,
            height: dispH,
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
 * Read the page count of a PDF blob without keeping it in memory.
 */
export async function readPdfPageCount(
  bytes: ArrayBuffer | Uint8Array,
): Promise<number> {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const doc = await PDFDocument.load(u8, { ignoreEncryption: true });
  return doc.getPageCount();
}

// Backward-compat re-export.
export type { CapturePageInput } from "@/lib/threatReportPageCapture";
