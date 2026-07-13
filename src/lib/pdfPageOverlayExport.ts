// Vector-PDF export with overlay compositing.
//
// Loads the original PDF via pdf-lib, copies each requested page as-is, and
// stamps a transparent overlay PNG on top. The copied page keeps its original
// vector content, MediaBox, CropBox, and /Rotate metadata.
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

function normalizedRotation(angle: number): 0 | 90 | 180 | 270 {
  const rot = ((Math.round(angle) % 360) + 360) % 360;
  if (rot === 90 || rot === 180 || rot === 270) return rot;
  return 0;
}

function overlayDrawOptionsForCopiedPage(opts: {
  mediaWidth: number;
  mediaHeight: number;
  displayWidth: number;
  displayHeight: number;
  rotation: 0 | 90 | 180 | 270;
}) {
  const { mediaWidth, mediaHeight, displayWidth, displayHeight, rotation } = opts;
  if (rotation === 90) {
    return {
      x: mediaWidth,
      y: 0,
      width: displayWidth,
      height: displayHeight,
      rotate: degrees(90),
    };
  }
  if (rotation === 180) {
    return {
      x: mediaWidth,
      y: mediaHeight,
      width: displayWidth,
      height: displayHeight,
      rotate: degrees(180),
    };
  }
  if (rotation === 270) {
    return {
      x: 0,
      y: mediaHeight,
      width: displayWidth,
      height: displayHeight,
      rotate: degrees(270),
    };
  }
  return {
    x: 0,
    y: 0,
    width: displayWidth,
    height: displayHeight,
  };
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
      const rotation = normalizedRotation(srcPage.getRotation().angle);
      const { width: mediaWidth, height: mediaHeight } = srcPage.getSize();
      const displayWidth = rotation % 180 === 0 ? mediaWidth : mediaHeight;
      const displayHeight = rotation % 180 === 0 ? mediaHeight : mediaWidth;

      // Preserve the original vector page. Re-drawing rotated pages as XObjects
      // caused blank output for real drawings whose MediaBox and /Rotate differ.
      const [newPage] = await out.copyPages(src, [idx]);
      out.addPage(newPage);

      if (includeOverlays && spec.overlays.length > 0) {
        const capture = await captureOverlayOnly({
          pageSize: { width: displayWidth, height: displayHeight },
          overlays: spec.overlays,
          outScale: 3,
        });
        if (capture) {
          const overlayBytes = await capture.blob.arrayBuffer();
          const png = await out.embedPng(new Uint8Array(overlayBytes));
          newPage.drawImage(
            png,
            overlayDrawOptionsForCopiedPage({
              mediaWidth,
              mediaHeight,
              displayWidth,
              displayHeight,
              rotation,
            }),
          );
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
