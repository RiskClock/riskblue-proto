import { useState, useEffect, useRef } from "react";
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
  coordinates: [number, number, number, number]; // [x_start, y_start, x_end, y_end]
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

// Color map for different system types
const getSystemColor = (systemType: string): string => {
  const type = systemType.toLowerCase();
  if (type.includes("cold water") || type.includes("dcw")) return "#3b82f6"; // blue
  if (type.includes("hot water") || type.includes("dhw")) return "#ef4444"; // red
  if (type.includes("fire") || type.includes("sprinkler")) return "#f97316"; // orange
  if (type.includes("storm") || type.includes("rain")) return "#8b5cf6"; // purple
  if (type.includes("sanitary")) return "#84cc16"; // lime
  if (type.includes("gas")) return "#eab308"; // yellow
  if (type.includes("condensate")) return "#06b6d4"; // cyan
  if (type.includes("irrigation")) return "#22c55e"; // green
  return "#6b7280"; // gray default
};

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

  // Filter detections for this file (show all if no fileName specified)
  const fileDetections = detections;

  // Debug logging
  useEffect(() => {
    console.log("FileViewerModal - all detections:", detections);
    console.log("FileViewerModal - fileDetections count:", fileDetections.length);
  }, [detections, fileDetections]);

  useEffect(() => {
    if (isOpen && fileId && accessToken) {
      loadFile();
    }
    return () => {
      setPageImages([]);
      setOriginalSize(null);
    };
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
    console.log("Original image size:", img.width, "x", img.height);

    // Draw image
    ctx.drawImage(img, 0, 0, displayWidth, displayHeight);

    // Calculate scale from original coordinates to display size
    // The coordinates in the sample are pixel coordinates from the original PDF/image
    // We need to scale them to our displayed canvas size
    const scaleX = displayWidth / img.width;
    const scaleY = displayHeight / img.height;

    console.log("Scale factors:", scaleX, scaleY);
    console.log("Drawing", fileDetections.length, "detections");

    // Draw bounding boxes
    fileDetections.forEach((detection, index) => {
      const [x1, y1, x2, y2] = detection.coordinates;
      const color = getSystemColor(detection.systemType);

      // Scale coordinates from original image pixels to displayed canvas
      const scaledX1 = x1 * scaleX;
      const scaledY1 = y1 * scaleY;
      const scaledX2 = x2 * scaleX;
      const scaledY2 = y2 * scaleY;
      
      const width = scaledX2 - scaledX1;
      const height = scaledY2 - scaledY1;

      console.log(`Detection ${index} "${detection.lineCode}": [${x1},${y1},${x2},${y2}] -> [${scaledX1.toFixed(0)},${scaledY1.toFixed(0)},${scaledX2.toFixed(0)},${scaledY2.toFixed(0)}]`);

      const isHovered = hoveredSystem === detection.lineCode;

      // Draw rectangle
      ctx.strokeStyle = color;
      ctx.lineWidth = isHovered ? 4 : 2;
      ctx.strokeRect(scaledX1, scaledY1, width, height);

      // Draw semi-transparent fill
      ctx.fillStyle = `${color}${isHovered ? '40' : '20'}`;
      ctx.fillRect(scaledX1, scaledY1, width, height);

      // Draw label
      const label = detection.lineCode || detection.systemType;
      ctx.font = `bold 12px sans-serif`;
      const textMetrics = ctx.measureText(label);
      const padding = 4;

      ctx.fillStyle = color;
      ctx.fillRect(scaledX1, scaledY1 - 20, textMetrics.width + padding * 2, 20);

      ctx.fillStyle = "#ffffff";
      ctx.fillText(label, scaledX1 + padding, scaledY1 - 6);
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
      const newZoom = Math.max(prev - 0.25, 0.5);
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
      <DialogContent className="max-w-[95vw] w-[95vw] h-[90vh] flex flex-col p-4">
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
                        borderLeftColor: getSystemColor(detection.systemType),
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
