import { useState, useEffect, useRef } from "react";
import { useMapNavigation } from "@/hooks/useMapNavigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, ZoomIn, ZoomOut, RotateCw, AlertCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

// Set worker path
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

interface SystemDetection {
  lineMonitored: string;
  lineCode: string;
  systemType: string;
  coordinates: [number, number, number, number]; // [x0, y0, x1, y1] PDF points or [x, y, w, h] normalized 0-1
  fileName?: string;
}

interface FileViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  fileId: string;
  fileName: string;
  mimeType: string;
  accessToken: string;
  detections: SystemDetection[];
}

// Highlighter green color for all bounding boxes
const BOUNDING_BOX_COLOR = "#39FF14"; // highlighter green

// A0 horizontal page dimensions in PDF points (reference for coordinates)
const A0_HORIZONTAL_WIDTH = 3370.4;
const A0_HORIZONTAL_HEIGHT = 2383.9;

export const FileViewerModal = ({
  isOpen,
  onClose,
  fileId,
  fileName,
  mimeType,
  accessToken,
  detections,
}: FileViewerModalProps) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [hoveredSystem, setHoveredSystem] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pageImages, setPageImages] = useState<HTMLImageElement[]>([]);
  const [originalSize, setOriginalSize] = useState<{ width: number; height: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileViewerMapNav = useMapNavigation({ zoom, setZoom, minZoom: 1, maxZoom: 8, containerRef });

  // Filter detections for this file (show all if no fileName specified)
  const fileDetections = detections;

  // Debug logging
  useEffect(() => {
    console.log("FileViewerModal - all detections:", detections);
    console.log("FileViewerModal - fileDetections count:", fileDetections.length);
  }, [detections, fileDetections]);

  // Load file when modal opens - consolidated effect to prevent race conditions
  useEffect(() => {
    if (isOpen && fileId && accessToken) {
      // Reset and load fresh
      setPageImages([]);
      setOriginalSize(null);
      setError(null);
      setZoom(1);
      setCurrentPage(1);
      setLoading(true);
      loadFile();
    } else if (!isOpen) {
      // Cleanup on close
      setPageImages([]);
      setOriginalSize(null);
      setLoading(false);
      setError(null);
    }
  }, [isOpen, fileId, accessToken]);

  const loadFile = async () => {
    setLoading(true);
    setError(null);
    setPageImages([]);
    setCurrentPage(1);
    setOriginalSize(null);

    try {
      const isPdf = mimeType.includes('pdf') || mimeType.includes('google-apps') || fileName.toLowerCase().endsWith('.pdf');
      
      let downloadUrl: string;
      let fetchMimeType = mimeType;

      if (mimeType.includes('google-apps')) {
        downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=application/pdf`;
        fetchMimeType = 'application/pdf';
      } else {
        downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
      }

      const response = await fetch(downloadUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to load file: ${response.status}`);
      }

      const blob = await response.blob();

      if (isPdf || fetchMimeType.includes('pdf')) {
        const arrayBuffer = await blob.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        setTotalPages(pdf.numPages);

        const images: HTMLImageElement[] = [];
        
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          const page = await pdf.getPage(pageNum);
          const scale = 2;
          const viewport = page.getViewport({ scale });

          const offscreenCanvas = document.createElement('canvas');
          const ctx = offscreenCanvas.getContext('2d');
          if (!ctx) continue;

          offscreenCanvas.width = viewport.width;
          offscreenCanvas.height = viewport.height;

          await page.render({
            canvasContext: ctx,
            viewport: viewport,
            canvas: offscreenCanvas,
          }).promise;

          const img = new Image();
          img.src = offscreenCanvas.toDataURL('image/png');
          await new Promise<void>((resolve) => {
            img.onload = () => resolve();
          });
          images.push(img);
          
          if (pageNum === 1) {
            // Store original PDF page size (before scale)
            setOriginalSize({ width: viewport.width / scale, height: viewport.height / scale });
            console.log("PDF original size:", viewport.width / scale, "x", viewport.height / scale);
          }
        }

        setPageImages(images);
        setLoading(false);
      } else {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          setPageImages([img]);
          setTotalPages(1);
          setOriginalSize({ width: img.naturalWidth, height: img.naturalHeight });
          console.log("Image original size:", img.naturalWidth, "x", img.naturalHeight);
          setLoading(false);
          URL.revokeObjectURL(url);
        };
        img.onerror = () => {
          setError("Failed to load image");
          setLoading(false);
          URL.revokeObjectURL(url);
        };
        img.src = url;
      }
    } catch (err) {
      console.error("Error loading file:", err);
      setError(err instanceof Error ? err.message : "Failed to load file");
      setLoading(false);
    }
  };

  // Draw canvas - triggered by dependencies
  useEffect(() => {
    if (loading || pageImages.length === 0) return;
    
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const img = pageImages[currentPage - 1];
    
    if (!canvas || !img || !container) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Get container size
    const containerRect = container.getBoundingClientRect();
    const containerWidth = containerRect.width - 32;
    const containerHeight = containerRect.height - 32;
    
    if (containerWidth <= 0 || containerHeight <= 0) return;

    const imgAspect = img.width / img.height;
    const containerAspect = containerWidth / containerHeight;

    let baseWidth: number;
    let baseHeight: number;

    if (imgAspect > containerAspect) {
      baseWidth = containerWidth;
      baseHeight = containerWidth / imgAspect;
    } else {
      baseHeight = containerHeight;
      baseWidth = containerHeight * imgAspect;
    }

    const displayWidth = Math.floor(baseWidth * zoom);
    const displayHeight = Math.floor(baseHeight * zoom);

    canvas.width = displayWidth;
    canvas.height = displayHeight;

    console.log("Drawing canvas:", displayWidth, "x", displayHeight, "zoom:", zoom);

    // Draw image
    ctx.drawImage(img, 0, 0, displayWidth, displayHeight);

    // Get PDF original dimensions for coordinate transformation
    const pdfWidth = originalSize?.width || img.width;
    const pdfHeight = originalSize?.height || img.height;
    
    console.log("Drawing", fileDetections.length, "detections, PDF size:", pdfWidth, "x", pdfHeight);

    // Draw bounding boxes
    fileDetections.forEach((detection, index) => {
      const coords = detection.coordinates;
      const color = BOUNDING_BOX_COLOR;
      const maxCoord = Math.max(...coords);
      
      let scaledX: number, scaledY: number, scaledWidth: number, scaledHeight: number;
      
      if (maxCoord <= 1) {
        // Normalized 0-1 format: [x, y, width, height]
        const [x, y, w, h] = coords;
        scaledX = x * displayWidth;
        scaledY = y * displayHeight;
        scaledWidth = w * displayWidth;
        scaledHeight = h * displayHeight;
        console.log(`Detection ${index} "${detection.lineCode}": normalized [${x},${y},${w},${h}]`);
      } else {
        // PDF points format: [x0, y0, x1, y1] - use actual PDF dimensions
        const [x0, y0, x1, y1] = coords;
        
        const boxWidth = x1 - x0;
        const boxHeight = y1 - y0;
        
        // Use actual PDF dimensions (from originalSize), fallback to A0 if not available
        const pdfWidthRef = originalSize?.width || A0_HORIZONTAL_WIDTH;
        const pdfHeightRef = originalSize?.height || A0_HORIZONTAL_HEIGHT;
        
        // Scale from PDF dimensions to display canvas
        const scaleX = displayWidth / pdfWidthRef;
        const scaleY = displayHeight / pdfHeightRef;
        
        // Transform: X stays same, Y flipped (PDF origin is bottom-left)
        scaledX = x0 * scaleX;
        scaledY = (pdfHeightRef - y1) * scaleY;
        scaledWidth = boxWidth * scaleX;
        scaledHeight = boxHeight * scaleY;
        
        console.log(`Detection ${index} "${detection.lineCode}": PDF [${pdfWidthRef}x${pdfHeightRef}] points [${x0},${y0},${x1},${y1}] -> canvas pos(${scaledX.toFixed(0)},${scaledY.toFixed(0)}) size(${scaledWidth.toFixed(0)}x${scaledHeight.toFixed(0)})`);
      }

      const isHovered = hoveredSystem === detection.lineCode;

      // Draw rectangle
      ctx.strokeStyle = color;
      ctx.lineWidth = isHovered ? 4 : 2;
      ctx.strokeRect(scaledX, scaledY, scaledWidth, scaledHeight);

      // Draw semi-transparent fill
      ctx.fillStyle = `${color}${isHovered ? '40' : '20'}`;
      ctx.fillRect(scaledX, scaledY, scaledWidth, scaledHeight);

      // Draw label
      const label = detection.lineCode || detection.systemType;
      ctx.font = `bold 12px sans-serif`;
      const textMetrics = ctx.measureText(label);
      const padding = 4;

      ctx.fillStyle = color;
      ctx.fillRect(scaledX, scaledY - 20, textMetrics.width + padding * 2, 20);

      ctx.fillStyle = "#ffffff";
      ctx.fillText(label, scaledX + padding, scaledY - 6);
    });
  }, [pageImages, currentPage, zoom, hoveredSystem, fileDetections, loading]);

  const handleZoomIn = () => {
    setZoom(prev => {
      const newZoom = Math.min(prev + 0.25, 3);
      console.log("Zoom in:", prev, "->", newZoom);
      return newZoom;
    });
  };
  
  const handleZoomOut = () => {
    setZoom(prev => {
      const newZoom = Math.max(1, prev - 0.25);
      console.log("Zoom out:", prev, "->", newZoom);
      return newZoom;
    });
  };
  
  const handleResetZoom = () => {
    console.log("Reset zoom to 1");
    setZoom(1);
  };
  
  const handlePrevPage = () => setCurrentPage((p) => Math.max(1, p - 1));
  const handleNextPage = () => setCurrentPage((p) => Math.min(totalPages, p + 1));

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-[95vw] w-[95vw] h-[90vh] flex flex-col p-4 [&>button]:top-4 [&>button]:right-4">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center justify-between gap-4">
            <span className="truncate flex-1">{fileName}</span>
            <div className="flex items-center gap-2 flex-shrink-0">
              {totalPages > 1 && (
                <>
                  <Button variant="outline" size="icon" onClick={handlePrevPage} disabled={currentPage === 1}>
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <span className="text-sm min-w-[5rem] text-center">
                    Page {currentPage} / {totalPages}
                  </span>
                  <Button variant="outline" size="icon" onClick={handleNextPage} disabled={currentPage === totalPages}>
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                  <div className="w-px h-6 bg-border mx-1" />
                </>
              )}
              <Button variant="outline" size="icon" onClick={handleZoomOut}>
                <ZoomOut className="w-4 h-4" />
              </Button>
              <span className="text-sm min-w-[4rem] text-center">
                {Math.round(zoom * 100)}%
              </span>
              <Button variant="outline" size="icon" onClick={handleZoomIn}>
                <ZoomIn className="w-4 h-4" />
              </Button>
              <Button variant="outline" size="icon" onClick={handleResetZoom}>
                <RotateCw className="w-4 h-4" />
              </Button>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-1 gap-4 overflow-hidden min-h-0">
          {/* Main content area */}
          <div 
            ref={containerRef}
            className="flex-1 border rounded-lg overflow-auto bg-muted/30 p-4"
          >
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center space-y-2">
                  <Loader2 className="w-8 h-8 animate-spin text-muted-foreground mx-auto" />
                  <p className="text-sm text-muted-foreground">Loading file...</p>
                </div>
              </div>
            ) : error ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center space-y-2">
                  <AlertCircle className="w-8 h-8 text-destructive mx-auto" />
                  <p className="text-sm text-destructive">{error}</p>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center min-h-full">
                <canvas ref={canvasRef} />
              </div>
            )}
          </div>

          {/* Legend sidebar */}
          {fileDetections.length > 0 && (
            <div className="w-64 flex-shrink-0 border rounded-lg p-3 flex flex-col">
              <h4 className="text-sm font-medium mb-2">Detected Systems ({fileDetections.length})</h4>
              <ScrollArea className="flex-1">
                <div className="space-y-2 pr-2">
                  {fileDetections.map((detection, i) => (
                    <div
                      key={i}
                      className="p-2 rounded-md border cursor-pointer transition-colors hover:bg-muted/50"
                      style={{
                        borderLeftWidth: 4,
                        borderLeftColor: BOUNDING_BOX_COLOR,
                        backgroundColor: hoveredSystem === detection.lineCode ? 'hsl(var(--muted))' : undefined,
                      }}
                      onMouseEnter={() => setHoveredSystem(detection.lineCode)}
                      onMouseLeave={() => setHoveredSystem(null)}
                    >
                      <p className="text-xs font-medium truncate">
                        {detection.lineCode}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {detection.systemType}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {detection.lineMonitored}
                      </p>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
