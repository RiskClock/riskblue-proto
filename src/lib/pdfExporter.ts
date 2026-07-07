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
  const { filename, margins, logoBase64, skipLogoOnFirstPage = true, fullBleedFirstPage = false, coverElement } = options;

  // Create PDF in A4 format
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const contentWidth = pageWidth - margins.left - margins.right;
  const contentHeight = pageHeight - margins.top - margins.bottom;

  let bodyStartPage = 0;

  // ── Page 1: Separate cover capture ──
  if (coverElement) {
    const coverCanvas = await html2canvas(coverElement, {
      scale: 2, useCORS: true, logging: false, allowTaint: true,
    });

    // Debug: save raw cover PNG
    if (options.debugSaveCoverPng) {
      const link = document.createElement('a');
      link.download = 'debug-cover-page.png';
      link.href = coverCanvas.toDataURL('image/png');
      link.click();
    }

    // Crop-to-fill: scale to cover the full A4 page
    const coverImgW = coverCanvas.width;
    const coverImgH = coverCanvas.height;
    const coverAspect = coverImgW / coverImgH;
    const pageAspect = pageWidth / pageHeight;

    let drawW: number, drawH: number, drawX: number, drawY: number;
    if (coverAspect > pageAspect) {
      // Image wider than page - fit height, crop width
      drawH = pageHeight;
      drawW = pageHeight * coverAspect;
      drawX = -(drawW - pageWidth) / 2;
      drawY = 0;
    } else {
      // Image taller than page - fit width, crop height
      drawW = pageWidth;
      drawH = pageWidth / coverAspect;
      drawX = 0;
      drawY = -(drawH - pageHeight) / 2;
    }

    const coverImgData = coverCanvas.toDataURL('image/jpeg', 0.98);
    pdf.addImage(coverImgData, 'JPEG', drawX, drawY, drawW, drawH);

    // Debug: draw red outline at page edges
    if (options.debugDrawPageOutline) {
      pdf.setDrawColor(255, 0, 0);
      pdf.setLineWidth(0.5);
      pdf.rect(0, 0, pageWidth, pageHeight);
    }

    bodyStartPage = 1;
  }

  // ── Remaining pages: capture the body element ──
  const canvas = await html2canvas(element, {
    scale: 2, useCORS: true, logging: false, allowTaint: true,
  });

  const imgWidth = canvas.width;
  const imgHeight = canvas.height;
  const scale = contentWidth / (imgWidth / 2);
  const scaledHeight = (imgHeight / 2) * scale;

  // Smart page breaking: find section boundaries to avoid cutting content
  const sectionBreakPoints: number[] = []; // in canvas pixel coordinates (scale=2)
  const keepTogetherElements = element.querySelectorAll('.print-keep-together, section, .page-break-avoid, .page-break-before');
  keepTogetherElements.forEach((el) => {
    const rect = (el as HTMLElement).getBoundingClientRect();
    const containerRect = element.getBoundingClientRect();
    const topInCanvas = (rect.top - containerRect.top) * 2; // scale=2
    sectionBreakPoints.push(topInCanvas);
  });
  sectionBreakPoints.sort((a, b) => a - b);

  // Find the best break point near a target Y position (in canvas pixels)
  const findBestBreak = (targetY: number, maxY: number): number => {
    // Look for a section boundary within 15% of content height before the target
    const tolerance = contentHeight / scale * 2 * 0.15;
    let bestBreak = targetY;
    for (const bp of sectionBreakPoints) {
      if (bp >= targetY - tolerance && bp <= targetY) {
        bestBreak = bp;
      }
    }
    return Math.min(bestBreak, maxY);
  };

  // Calculate pages with smart breaks
  const pageBreaks: number[] = [0]; // sourceY positions in canvas pixels
  let currentY = 0;
  const firstPageH = (!coverElement && fullBleedFirstPage) ? pageHeight : contentHeight;
  const firstPagePixels = (firstPageH / scale) * 2;
  
  if (scaledHeight > firstPageH) {
    let nextBreak = findBestBreak(firstPagePixels, imgHeight);
    pageBreaks.push(nextBreak);
    currentY = nextBreak;
    
    const normalPagePixels = (contentHeight / scale) * 2;
    while (currentY < imgHeight - normalPagePixels * 0.1) {
      const targetY = currentY + normalPagePixels;
      if (targetY >= imgHeight) break;
      nextBreak = findBestBreak(targetY, imgHeight);
      if (nextBreak <= currentY) break;
      pageBreaks.push(nextBreak);
      currentY = nextBreak;
    }
  }

  const totalPages = pageBreaks.length;

  // Pre-calculate logo dimensions from natural aspect ratio
  let logoW = 18;
  const logoH = 8.2;
  if (logoBase64) {
    const dims = await new Promise<{ w: number; h: number }>((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve({ w: 18, h: 8.2 });
      img.src = logoBase64;
    });
    if (dims.h > 0) {
      logoW = logoH * (dims.w / dims.h);
    }
  }

  for (let page = 0; page < totalPages; page++) {
    if (page > 0 || bodyStartPage > 0) {
      pdf.addPage();
    }

    const isFullBleed = !coverElement && fullBleedFirstPage && page === 0;
    const pageMarginLeft = isFullBleed ? 0 : margins.left;
    const pageMarginTop = isFullBleed ? 0 : margins.top;
    const pageContentWidth = isFullBleed ? pageWidth : contentWidth;
    const pageContentHeight = isFullBleed ? pageHeight : contentHeight;

    const sourceY = pageBreaks[page];
    const nextSourceY = page + 1 < totalPages ? pageBreaks[page + 1] : imgHeight;
    const sourceHeight = Math.min(
      nextSourceY - sourceY,
      (pageContentHeight / scale) * 2
    );

    if (sourceHeight <= 0) break;

    const pageCanvas = document.createElement('canvas');
    pageCanvas.width = imgWidth;
    pageCanvas.height = sourceHeight;
    const ctx = pageCanvas.getContext('2d');
    
    if (ctx) {
      ctx.drawImage(canvas, 0, sourceY, imgWidth, sourceHeight, 0, 0, imgWidth, sourceHeight);

      if (!coverElement && options.debugSaveCoverPng && page === 0) {
        const link = document.createElement('a');
        link.download = 'debug-cover-page.png';
        link.href = pageCanvas.toDataURL('image/png');
        link.click();
      }

      const pageImgData = pageCanvas.toDataURL('image/jpeg', 0.98);
      const pageImgHeight = (sourceHeight / 2) * scale;

      pdf.addImage(pageImgData, 'JPEG', pageMarginLeft, pageMarginTop, pageContentWidth, pageImgHeight);
    }

    // Add logo to footer (skip cover page)
    const globalPageIndex = bodyStartPage + page;
    if (logoBase64 && (!skipLogoOnFirstPage || globalPageIndex > 0)) {
      pdf.addImage(logoBase64, 'PNG', pageWidth - margins.right - logoW, pageHeight - 14, logoW, logoH);
    }
  }

  if (options.returnBlob) {
    return pdf.output('blob');
  }

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
export function getImageBase64(imgSrc: string, format: 'png' | 'jpeg' = 'png'): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img, 0, 0);
      const base64 = format === 'png'
        ? canvas.toDataURL('image/png')
        : canvas.toDataURL('image/jpeg', 0.92);
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
