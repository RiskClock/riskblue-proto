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
  /**
   * Optional extra rotation to apply on top of the source page's /Rotate.
   * Baked into the output PDF via setRotation, so PDF viewers show the page
   * in the same orientation as the in-app DrawingViewer (which composes
   * source /Rotate with the user's rotation).
   */
  userRotation?: 0 | 90 | 180 | 270;
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
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
  displayWidth: number;
  displayHeight: number;
  rotation: 0 | 90 | 180 | 270;
}) {
  const { cropX, cropY, cropWidth, cropHeight, displayWidth, displayHeight, rotation } = opts;
  // Anchor overlay within the visible CropBox rather than the raw MediaBox.
  // Using MediaBox caused a consistent offset on pages whose CropBox differs
  // from MediaBox (typical for drawings with print bleeds / trim marks).
  const left = cropX;
  const bottom = cropY;
  const right = cropX + cropWidth;
  const top = cropY + cropHeight;
  if (rotation === 90) {
    return {
      x: right,
      y: bottom,
      width: displayWidth,
      height: displayHeight,
      rotate: degrees(90),
    };
  }
  if (rotation === 180) {
    return {
      x: right,
      y: top,
      width: displayWidth,
      height: displayHeight,
      rotate: degrees(180),
    };
  }
  if (rotation === 270) {
    return {
      x: left,
      y: top,
      width: displayWidth,
      height: displayHeight,
      rotate: degrees(270),
    };
  }
  return {
    x: left,
    y: bottom,
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
      // Use CropBox (the visible area of the page) rather than MediaBox to
      // anchor overlays. PDF viewers clip to CropBox, so overlay coordinates
      // computed against the visible page must be positioned within it — using
      // MediaBox caused a consistent x/y offset on drawings whose CropBox is
      // inset from the MediaBox.
      const cropBox = srcPage.getCropBox();
      const cropWidth = cropBox.width;
      const cropHeight = cropBox.height;
      const cropX = cropBox.x;
      const cropY = cropBox.y;
      const userRot = spec.userRotation ?? 0;
      const totalRot = (((rotation + userRot) % 360) + 360) % 360 as 0 | 90 | 180 | 270;

      // Dimensions the overlay PNG must match — the fully-rotated display view.
      const totalDisplayWidth = totalRot % 180 === 0 ? cropWidth : cropHeight;
      const totalDisplayHeight = totalRot % 180 === 0 ? cropHeight : cropWidth;

      // Preserve the original vector page. Re-drawing rotated pages as XObjects
      // caused blank output for real drawings whose MediaBox and /Rotate differ.
      const [newPage] = await out.copyPages(src, [idx]);
      out.addPage(newPage);

      if (includeOverlays && spec.overlays.length > 0) {
        const capture = await captureOverlayOnly({
          // Base the layout on the post-source-rotation dims (the coordinate
          // space overlays are stored in). captureOverlayOnly will swap dims
          // internally when userRotationDeg is 90/270.
          pageSize: {
            width: rotation % 180 === 0 ? cropWidth : cropHeight,
            height: rotation % 180 === 0 ? cropHeight : cropWidth,
          },
          overlays: spec.overlays,
          outScale: 3,
          userRotationDeg: userRot,
        });
        if (capture) {
          const overlayBytes = await capture.blob.arrayBuffer();
          const png = await out.embedPng(new Uint8Array(overlayBytes));
          // Stamp using the total (source + user) rotation so the PNG lands
          // correctly after the PDF viewer applies setRotation(totalRot).
          newPage.drawImage(
            png,
            overlayDrawOptionsForCopiedPage({
              cropX,
              cropY,
              cropWidth,
              cropHeight,
              displayWidth: totalDisplayWidth,
              displayHeight: totalDisplayHeight,
              rotation: totalRot,
            }),
          );
        }
      }

      // Bake the user's rotation on top of the source page's /Rotate. The
      // overlay stamp was drawn into the page content stream above; it will
      // rotate together with the page and match the in-app viewer.
      if (userRot) {
        newPage.setRotation(degrees(totalRot));
      }

      done += 1;
      opts.onProgress?.(done, totalPages);

      // Yield to the browser between pages so the UI stays responsive on
      // large multi-page exports (prevents the "page unresponsive" prompt).
      await new Promise<void>((r) => setTimeout(r, 0));
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
