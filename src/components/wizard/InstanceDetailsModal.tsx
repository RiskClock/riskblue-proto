import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, ZoomIn, ZoomOut, RotateCw, AlertCircle, ChevronLeft, ChevronRight, FileImage } from "lucide-react";
import { AnalysisItem } from "@/lib/analysisItemMapper";
import type { DriveFileInfo } from "./ProjectFilesUpload";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

// Set worker path
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

interface InstanceDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  instance: AnalysisItem | null;
  canViewFile?: boolean;
  driveFile?: DriveFileInfo;
  driveAccessToken?: string | null;
}

// Highlighter green color for bounding boxes
const BOUNDING_BOX_COLOR = "#39FF14";

export const InstanceDetailsModal = ({ 
  isOpen, 
  onClose, 
  instance, 
  canViewFile = false,
  driveFile,
  driveAccessToken
}: InstanceDetailsModalProps) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pageImages, setPageImages] = useState<HTMLImageElement[]>([]);
  const [originalSize, setOriginalSize] = useState<{ width: number; height: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const showDrawing = canViewFile && driveFile && driveAccessToken;

  // Reset state when modal opens/closes or instance changes
  useEffect(() => {
    if (isOpen) {
      setPageImages([]);
      setOriginalSize(null);
      setLoading(false);
      setError(null);
      setZoom(1);
      setCurrentPage(1);
    }
  }, [isOpen, instance]);

  // Auto-load file when modal opens and can view
  useEffect(() => {
    if (isOpen && showDrawing && pageImages.length === 0) {
      loadFile();
    }
  }, [isOpen, showDrawing]);

  const loadFile = async () => {
    if (!driveFile || !driveAccessToken) return;
    
    setLoading(true);
    setError(null);
    setPageImages([]);
    setCurrentPage(1);
    setOriginalSize(null);

    try {
      const isPdf = driveFile.mimeType.includes('pdf') || driveFile.mimeType.includes('google-apps') || driveFile.name.toLowerCase().endsWith('.pdf');
      
      let downloadUrl: string;
      let fetchMimeType = driveFile.mimeType;

      if (driveFile.mimeType.includes('google-apps')) {
        downloadUrl = `https://www.googleapis.com/drive/v3/files/${driveFile.id}/export?mimeType=application/pdf`;
        fetchMimeType = 'application/pdf';
      } else {
        downloadUrl = `https://www.googleapis.com/drive/v3/files/${driveFile.id}?alt=media`;
      }

      const response = await fetch(downloadUrl, {
        headers: {
          Authorization: `Bearer ${driveAccessToken}`,
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
            setOriginalSize({ width: viewport.width / scale, height: viewport.height / scale });
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

  // Draw canvas with bounding boxes
  useEffect(() => {
    if (loading || pageImages.length === 0) return;
    
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const img = pageImages[currentPage - 1];
    
    if (!canvas || !img || !container) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

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

    // Draw image
    ctx.drawImage(img, 0, 0, displayWidth, displayHeight);

    // Draw bounding box for instance if coordinates exist
    if (instance?.coordinates && instance.coordinates.length === 4) {
      const coords = instance.coordinates;
      const maxCoord = Math.max(...coords);
      
      // Get PDF original dimensions for coordinate transformation
      const pdfWidth = originalSize?.width || img.width;
      const pdfHeight = originalSize?.height || img.height;
      
      let scaledX: number, scaledY: number, scaledWidth: number, scaledHeight: number;
      
      if (maxCoord <= 1) {
        // Normalized 0-1 format: [x, y, width, height]
        const [x, y, w, h] = coords;
        scaledX = x * displayWidth;
        scaledY = y * displayHeight;
        scaledWidth = w * displayWidth;
        scaledHeight = h * displayHeight;
      } else {
        // PDF points format: [x0, y0, x1, y1] (bottom-left to top-right)
        // PDF origin is bottom-left, canvas origin is top-left
        const [x0, y0, x1, y1] = coords;
        
        // Calculate box dimensions in PDF points
        const boxWidth = x1 - x0;
        const boxHeight = y1 - y0;
        
        // Scale factors from PDF points to display canvas
        const scaleX = displayWidth / pdfWidth;
        const scaleY = displayHeight / pdfHeight;
        
        // Transform: X stays same, Y needs to be flipped
        scaledX = x0 * scaleX;
        scaledY = (pdfHeight - y1) * scaleY;  // Flip Y: use y1 (top) and subtract from height
        scaledWidth = boxWidth * scaleX;
        scaledHeight = boxHeight * scaleY;
      }

      // Draw rectangle
      ctx.strokeStyle = BOUNDING_BOX_COLOR;
      ctx.lineWidth = 3;
      ctx.strokeRect(scaledX, scaledY, scaledWidth, scaledHeight);

      // Draw semi-transparent fill
      ctx.fillStyle = `${BOUNDING_BOX_COLOR}30`;
      ctx.fillRect(scaledX, scaledY, scaledWidth, scaledHeight);

      // Draw label
      const label = instance.id;
      ctx.font = `bold 14px sans-serif`;
      const textMetrics = ctx.measureText(label);
      const padding = 6;

      ctx.fillStyle = BOUNDING_BOX_COLOR;
      ctx.fillRect(scaledX, scaledY - 24, textMetrics.width + padding * 2, 24);

      ctx.fillStyle = "#000000";
      ctx.fillText(label, scaledX + padding, scaledY - 7);
    }
  }, [pageImages, currentPage, zoom, loading, instance, originalSize]);

  if (!instance) return null;

  const capitalize = (str: string) => str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  
  // Get additional parameters if available
  const additionalParams = (instance as any).additionalParameters;
  const pipeInfo = additionalParams?.pipeDiameterMM 
    ? `${additionalParams.pipeDiameterMM}mm` 
    : additionalParams?.pipeDiameterInches 
      ? `${additionalParams.pipeDiameterInches}"` 
      : null;
  const directionInfo = additionalParams?.mainPipeDirection 
    ? capitalize(additionalParams.mainPipeDirection)
    : null;

  const sizeDisplay = instance.sizeCategory ? `${capitalize(instance.sizeCategory)} Room` : null;
  const dimensionDisplay = instance.length && instance.width 
    ? `${instance.length} ft × ${instance.width} ft` 
    : null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className={showDrawing ? "sm:max-w-5xl h-[85vh] flex flex-col p-0" : "sm:max-w-md"}>
        <DialogHeader className="px-6 pt-6 pb-4 border-b flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <span className="text-muted-foreground text-sm">{instance.id}:</span>
            {instance.areaName || instance.name}
          </DialogTitle>
        </DialogHeader>
        
        {showDrawing ? (
          <div className="flex-1 flex min-h-0 overflow-hidden">
            {/* Left side - Details */}
            <div className="w-80 flex-shrink-0 border-r overflow-y-auto p-6">
              <div className="space-y-4">
                {/* Category & Floor */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Category</label>
                    <p className="text-sm font-medium mt-1">{instance.category}</p>
                  </div>
                  {instance.floor && (
                    <div>
                      <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Floor</label>
                      <p className="text-sm font-medium mt-1">{instance.floor}</p>
                    </div>
                  )}
                </div>

                {/* Size & Dimensions */}
                {(sizeDisplay || dimensionDisplay) && (
                  <div className="grid grid-cols-2 gap-4">
                    {sizeDisplay && (
                      <div>
                        <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Size</label>
                        <p className="text-sm font-medium mt-1">{sizeDisplay}</p>
                      </div>
                    )}
                    {dimensionDisplay && (
                      <div>
                        <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Dimensions</label>
                        <p className="text-sm font-medium mt-1">{dimensionDisplay}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Pipe Information */}
                {(pipeInfo || directionInfo) && (
                  <div className="grid grid-cols-2 gap-4">
                    {pipeInfo && (
                      <div>
                        <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Pipe Diameter</label>
                        <p className="text-sm font-medium mt-1">{pipeInfo}</p>
                      </div>
                    )}
                    {directionInfo && (
                      <div>
                        <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Pipe Direction</label>
                        <p className="text-sm font-medium mt-1">{directionInfo}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Drawing Info */}
                {(instance.drawingCode || instance.fileName) && (
                  <div className="space-y-3">
                    {instance.drawingCode && (
                      <div>
                        <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Drawing Code</label>
                        <p className="text-sm font-medium mt-1">{instance.drawingCode}</p>
                      </div>
                    )}
                    {instance.fileName && (
                      <div>
                        <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Source File</label>
                        <p className="text-sm font-medium mt-1 truncate" title={instance.fileName}>{instance.fileName}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Controls */}
                {instance.controls && instance.controls.length > 0 && (
                  <div>
                    <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Recommended Controls</label>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {instance.controls.map((control, idx) => (
                        <Badge key={idx} variant="outline" className="text-xs">
                          {control}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
            
            {/* Right side - Drawing */}
            <div className="flex-1 flex flex-col min-h-0 p-4">
              {/* Zoom controls */}
              <div className="flex items-center justify-between mb-3 flex-shrink-0">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <FileImage className="w-4 h-4" />
                  <span>Drawing Preview</span>
                </div>
                <div className="flex items-center gap-2">
                  {totalPages > 1 && (
                    <>
                      <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}>
                        <ChevronLeft className="w-4 h-4" />
                      </Button>
                      <span className="text-sm min-w-[5rem] text-center">
                        Page {currentPage} / {totalPages}
                      </span>
                      <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                      <div className="w-px h-6 bg-border mx-1" />
                    </>
                  )}
                  <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setZoom(z => Math.max(0.5, z - 0.25))}>
                    <ZoomOut className="w-4 h-4" />
                  </Button>
                  <span className="text-sm min-w-[3rem] text-center">
                    {Math.round(zoom * 100)}%
                  </span>
                  <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setZoom(z => Math.min(3, z + 0.25))}>
                    <ZoomIn className="w-4 h-4" />
                  </Button>
                  <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setZoom(1)}>
                    <RotateCw className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              
              {/* Drawing viewer */}
              <div 
                ref={containerRef}
                className="flex-1 border rounded-lg overflow-auto bg-muted/30 p-4 min-h-0"
              >
                {loading ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center space-y-2">
                      <Loader2 className="w-8 h-8 animate-spin text-muted-foreground mx-auto" />
                      <p className="text-sm text-muted-foreground">Loading drawing...</p>
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
            </div>
          </div>
        ) : (
          <div className="space-y-4 p-6">
            {/* Category & Floor */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Category</label>
                <p className="text-sm font-medium mt-1">{instance.category}</p>
              </div>
              {instance.floor && (
                <div>
                  <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Floor</label>
                  <p className="text-sm font-medium mt-1">{instance.floor}</p>
                </div>
              )}
            </div>

            {/* Size & Dimensions */}
            {(sizeDisplay || dimensionDisplay) && (
              <div className="grid grid-cols-2 gap-4">
                {sizeDisplay && (
                  <div>
                    <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Size</label>
                    <p className="text-sm font-medium mt-1">{sizeDisplay}</p>
                  </div>
                )}
                {dimensionDisplay && (
                  <div>
                    <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Dimensions</label>
                    <p className="text-sm font-medium mt-1">{dimensionDisplay}</p>
                  </div>
                )}
              </div>
            )}

            {/* Pipe Information */}
            {(pipeInfo || directionInfo) && (
              <div className="grid grid-cols-2 gap-4">
                {pipeInfo && (
                  <div>
                    <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Pipe Diameter</label>
                    <p className="text-sm font-medium mt-1">{pipeInfo}</p>
                  </div>
                )}
                {directionInfo && (
                  <div>
                    <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Pipe Direction</label>
                    <p className="text-sm font-medium mt-1">{directionInfo}</p>
                  </div>
                )}
              </div>
            )}

            {/* Drawing Info */}
            {(instance.drawingCode || instance.fileName) && (
              <div className="grid grid-cols-2 gap-4">
                {instance.drawingCode && (
                  <div>
                    <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Drawing Code</label>
                    <p className="text-sm font-medium mt-1">{instance.drawingCode}</p>
                  </div>
                )}
                {instance.fileName && (
                  <div>
                    <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Source File</label>
                    <p className="text-sm font-medium mt-1 truncate">{instance.fileName}</p>
                  </div>
                )}
              </div>
            )}

            {/* Controls */}
            {instance.controls && instance.controls.length > 0 && (
              <div>
                <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Recommended Controls</label>
                <div className="flex flex-wrap gap-1 mt-2">
                  {instance.controls.map((control, idx) => (
                    <Badge key={idx} variant="outline" className="text-xs">
                      {control}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
