import * as pdfjsLib from 'pdfjs-dist';

// Configure PDF.js worker - use the bundled worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString();

export interface PDFPageData {
  pageNumber: number;
  text: string;
}

export interface PDFMetadata {
  pageCount: number;
  fileSize: string;
  pages: PDFPageData[];
}

export const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
};

export const extractPDFData = async (
  file: File,
  onProgress?: (progress: number, pageNumber: number) => void,
  onPageCountKnown?: (pageCount: number) => void
): Promise<PDFMetadata> => {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
  
  // Notify page count immediately
  if (onPageCountKnown) {
    onPageCountKnown(pdf.numPages);
  }
  
  const pages: PDFPageData[] = [];
  
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const text = textContent.items.map((item: any) => item.str).join(' ');
    
    pages.push({ pageNumber: i, text });
    
    if (onProgress) {
      onProgress(i / pdf.numPages, i);
    }
    
    // Small delay to allow UI updates
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  
  return {
    pageCount: pdf.numPages,
    fileSize: formatFileSize(file.size),
    pages,
  };
};

export const extractKeyInformation = (pages: PDFPageData[]) => {
  const allText = pages.map(p => p.text).join(' ');
  
  // Extract dates (basic pattern matching)
  const datePattern = /\b(\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\w+ \d{1,2},? \d{4})\b/g;
  const dates = Array.from(new Set(allText.match(datePattern) || [])).slice(0, 5);
  
  // Extract potential milestones (lines with dates or phase keywords)
  const milestoneKeywords = ['phase', 'milestone', 'completion', 'delivery', 'start', 'finish', 'deadline'];
  const milestones = pages
    .flatMap(p => p.text.split(/[.!?\n]/).filter(sentence => 
      milestoneKeywords.some(keyword => sentence.toLowerCase().includes(keyword))
    ))
    .slice(0, 5);
  
  return { dates, milestones };
};
