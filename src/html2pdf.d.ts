declare module 'html2pdf.js' {
  interface Html2PdfOptions {
    margin?: number | number[];
    filename?: string;
    image?: { type?: string; quality?: number };
    html2canvas?: {
      scale?: number;
      useCORS?: boolean;
      logging?: boolean;
      letterRendering?: boolean;
    };
    jsPDF?: {
      unit?: string;
      format?: string;
      orientation?: string;
    };
    pagebreak?: {
      mode?: string[];
    };
  }

  interface Html2Pdf {
    set(options: Html2PdfOptions): Html2Pdf;
    from(element: HTMLElement | string): Html2Pdf;
    toPdf(): Html2Pdf;
    get(type: string): Html2Pdf;
    then(callback: (pdf: any) => any): Html2Pdf;
    save(): Promise<void>;
    outputPdf(type?: string): Promise<any>;
  }

  function html2pdf(): Html2Pdf;
  export default html2pdf;
}