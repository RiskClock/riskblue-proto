import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

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
}

/**
 * Generates a PDF from an HTML element using jsPDF and html2canvas directly.
 * This replaces html2pdf.js to avoid the jsPDF path traversal vulnerability.
 */
export async function generatePdfFromElement(
  element: HTMLElement,
  options: PdfExportOptions
): Promise<void> {
  const { filename, margins, logoBase64, skipLogoOnFirstPage = true } = options;

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
  const totalPages = Math.ceil(scaledHeight / contentHeight);

  // Add content page by page
  for (let page = 0; page < totalPages; page++) {
    if (page > 0) {
      pdf.addPage();
    }

    // Calculate the portion of the image to show on this page
    const sourceY = (page * contentHeight) / scale * 2; // Convert back to canvas pixels
    const sourceHeight = Math.min(
      (contentHeight / scale) * 2,
      imgHeight - sourceY
    );

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

      const pageImgData = pageCanvas.toDataURL('image/jpeg', 0.98);
      const pageImgHeight = (sourceHeight / 2) * scale;

      pdf.addImage(
        pageImgData,
        'JPEG',
        margins.left,
        margins.top,
        contentWidth,
        pageImgHeight
      );
    }

    // Add logo to footer (skip first page if specified)
    if (logoBase64 && (!skipLogoOnFirstPage || page > 0)) {
      // Logo dimensions: 18mm wide x 6mm tall
      // Position: right-aligned with margin, 8mm from bottom
      pdf.addImage(
        logoBase64,
        'JPEG',
        pageWidth - margins.right - 18,
        pageHeight - 12,
        18,
        6
      );
    }
  }

  // Save the PDF
  pdf.save(`${filename}.pdf`);
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
 * Waits for all images in a container to load.
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
      if (img.complete && img.naturalHeight !== 0) {
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
