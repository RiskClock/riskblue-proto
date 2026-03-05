import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { supabase } from '@/integrations/supabase/client';


interface PdfExportOptions {
  filename: string;
  margins: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  logoBase64?: string;
  skipLogoOnFirstPage?: boolean;
  returnBlob?: boolean;
  fullBleedFirstPage?: boolean;
  debugSaveCoverPng?: boolean;
  debugDrawPageOutline?: boolean;
  /** If provided, this element is captured separately as a full-bleed cover page (page 1). */
  coverElement?: HTMLElement;
}

/**
 * Generates a PDF from an HTML element using jsPDF and html2canvas directly.
 * This replaces html2pdf.js to avoid the jsPDF path traversal vulnerability.
 */
export async function generatePdfFromElement(
  element: HTMLElement,
  options: PdfExportOptions
): Promise<Blob | void> {
  const { filename, margins, logoBase64, skipLogoOnFirstPage = true, fullBleedFirstPage = false } = options;

  // Capture the HTML element as a canvas
  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    logging: false,
    allowTaint: true,
  });

  const imgData = canvas.toDataURL('image/jpeg', 0.98);
  const imgWidth = canvas.width;
  const imgHeight = canvas.height;

  // Create PDF in A4 format
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  // Calculate content area dimensions
  const contentWidth = pageWidth - margins.left - margins.right;
  const contentHeight = pageHeight - margins.top - margins.bottom;

  // Calculate scale to fit width
  const scale = contentWidth / (imgWidth / 2); // Divide by 2 because html2canvas scale is 2
  const scaledHeight = (imgHeight / 2) * scale;

  // Calculate how many pages we need
  // If fullBleedFirstPage, first page uses full page height, rest use contentHeight
  const firstPageH = fullBleedFirstPage ? pageHeight : contentHeight;
  const totalPages = scaledHeight <= firstPageH ? 1 : 1 + Math.ceil((scaledHeight - firstPageH) / contentHeight);

  // Add content page by page
  for (let page = 0; page < totalPages; page++) {
    if (page > 0) {
      pdf.addPage();
    }

    // For the first page with fullBleed, use zero margins
    const isFullBleed = fullBleedFirstPage && page === 0;
    const pageMarginLeft = isFullBleed ? 0 : margins.left;
    const pageMarginTop = isFullBleed ? 0 : margins.top;
    const pageContentWidth = isFullBleed ? pageWidth : contentWidth;
    const pageContentHeight = isFullBleed ? pageHeight : contentHeight;

    // Calculate the portion of the image to show on this page
    // For page 0 we use its own content height; for subsequent pages we accumulate
    let sourceY: number;
    if (page === 0) {
      sourceY = 0;
    } else {
      // First page consumed its own content height, subsequent pages use normal contentHeight
      const firstPageContentH = fullBleedFirstPage ? pageHeight : contentHeight;
      sourceY = (firstPageContentH + (page - 1) * contentHeight) / scale * 2;
    }
    const sourceHeight = Math.min(
      (pageContentHeight / scale) * 2,
      imgHeight - sourceY
    );

    if (sourceHeight <= 0) break;

    // Create a temporary canvas for this page's content
    const pageCanvas = document.createElement('canvas');
    pageCanvas.width = imgWidth;
    pageCanvas.height = sourceHeight;
    const ctx = pageCanvas.getContext('2d');
    
    if (ctx) {
      ctx.drawImage(
        canvas,
        0,
        sourceY,
        imgWidth,
        sourceHeight,
        0,
        0,
        imgWidth,
        sourceHeight
      );

      // Debug: save cover page canvas as PNG for diagnostics
      if (options.debugSaveCoverPng && page === 0) {
        const link = document.createElement('a');
        link.download = 'debug-cover-page.png';
        link.href = pageCanvas.toDataURL('image/png');
        link.click();
      }

      const pageImgData = pageCanvas.toDataURL('image/jpeg', 0.98);
      const pageImgHeight = (sourceHeight / 2) * scale;

      pdf.addImage(
        pageImgData,
        'JPEG',
        pageMarginLeft,
        pageMarginTop,
        pageContentWidth,
        pageImgHeight
      );
    }

    // Add logo to footer (skip first page if specified)
    if (logoBase64 && (!skipLogoOnFirstPage || page > 0)) {
      pdf.addImage(
        logoBase64,
        'PNG',
        pageWidth - margins.right - 18,
        pageHeight - 12,
        18,
        6
      );
    }
  }

  if (options.returnBlob) {
    return pdf.output('blob');
  }

  // Save the PDF
  pdf.save(`${filename}.pdf`);
}

/**
 * Fetches an image from private storage via the storage-image-proxy edge function
 * and converts it to a base64 data URL. Bypasses CORS entirely.
 */
export async function proxyImageToDataUrl(bucket: string, path: string): Promise<string> {
  try {
    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    if (!token) {
      console.warn('[PDF] proxyImageToDataUrl: no auth token');
      return '';
    }

    const proxyUrl = `https://${projectId}.supabase.co/functions/v1/storage-image-proxy?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(path)}`;
    const res = await fetch(proxyUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      credentials: 'omit',
      cache: 'no-store',
    });

    if (!res.ok) {
      console.warn('[PDF] proxyImageToDataUrl failed', { bucket, path, status: res.status });
      return '';
    }

    const blob = await res.blob();
    return await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = () => resolve('');
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.warn('[PDF] proxyImageToDataUrl error', { bucket, path, error: e });
    return '';
  }
}

/**
 * Converts an image source to base64 string.
 */
export function getImageBase64(imgSrc: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img, 0, 0);
      const base64 = canvas.toDataURL('image/jpeg', 0.92);
      resolve(base64);
    };
    img.onerror = () => {
      console.warn('[PDF] image->base64 failed', { src: imgSrc });
      resolve('');
    };
    img.src = imgSrc;
  });
}

/**
 * Waits for all images in a container to load (with naturalWidth validation).
 */
export function waitForImages(container: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    const images = container.querySelectorAll('img');
    if (images.length === 0) {
      resolve();
      return;
    }

    let loadedCount = 0;
    const checkComplete = () => {
      loadedCount++;
      if (loadedCount >= images.length) {
        resolve();
      }
    };

    images.forEach((img) => {
      if (img.complete && img.naturalWidth > 0) {
        checkComplete();
      } else {
        img.onload = checkComplete;
        img.onerror = checkComplete;
      }
    });

    // Timeout fallback
    setTimeout(resolve, 5000);
  });
}
