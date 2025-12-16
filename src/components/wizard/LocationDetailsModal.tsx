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

interface LocationDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  location: AnalysisItem | null;
  canViewFile?: boolean;
  driveFile?: DriveFileInfo;
  driveAccessToken?: string | null;
}

// Highlighter green color for bounding boxes
const BOUNDING_BOX_COLOR = "#39FF14";

// A0 horizontal page dimensions in PDF points (reference for coordinates)
const A0_HORIZONTAL_WIDTH = 3370.4;
const A0_HORIZONTAL_HEIGHT = 2383.9;

export const LocationDetailsModal = ({ 
  isOpen, 
  onClose, 
  location, 
  canViewFile = false,
  driveFile,
  driveAccessToken
}: LocationDetailsModalProps) => {
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

  // Load file when modal opens - single consolidated effect
  useEffect(() => {
    if (isOpen && showDrawing) {
      // Reset state and load fresh
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
  }, [isOpen, showDrawing, location]);

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

    // Draw bounding box for location if coordinates exist
    if (location?.coordinates && location.coordinates.length === 4) {
      const coords = location.coordinates;
      const maxCoord = Math.max(...coords);
      
      let scaledX: number, scaledY: number, scaledWidth: number, scaledHeight: number;
      
      if (maxCoord <= 1) {
        // Normalized 0-1 format: [x, y, width, height]
        const [x, y, w, h] = coords;
        scaledX = x * displayWidth;
        scaledY = y * displayHeight;
        scaledWidth = w * displayWidth;
        scaledHeight = h * displayHeight;
      } else {
        // PDF points format: [x0, y0, x1, y1] - use actual PDF dimensions
        const [x0, y0, x1, y1] = coords;
        
        const boxWidth = x1 - x0;
        const boxHeight = y1 - y0;
        
        // Use actual PDF dimensions if available, fallback to A0
        const pdfWidth = originalSize?.width || A0_HORIZONTAL_WIDTH;
        const pdfHeight = originalSize?.height || A0_HORIZONTAL_HEIGHT;
        
        // Scale from PDF dimensions to display canvas
        const scaleX = displayWidth / pdfWidth;
        const scaleY = displayHeight / pdfHeight;
        
        // Transform: X stays same, Y flipped (PDF origin is bottom-left)
        scaledX = x0 * scaleX;
        scaledY = (pdfHeight - y1) * scaleY;
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
      const label = location.id;
      ctx.font = `bold 14px sans-serif`;
      const textMetrics = ctx.measureText(label);
      const padding = 6;

      ctx.fillStyle = BOUNDING_BOX_COLOR;
      ctx.fillRect(scaledX, scaledY - 24, textMetrics.width + padding * 2, 24);

      ctx.fillStyle = "#000000";
      ctx.fillText(label, scaledX + padding, scaledY - 7);
    }
  }, [pageImages, currentPage, zoom, loading, location, originalSize]);

  if (!location) return null;

  const capitalize = (str: string) => str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  
  // Get additional parameters if available
  const additionalParams = (location as any).additionalParameters;
  const pipeInfo = additionalParams?.pipeDiameterMM 
    ? `${additionalParams.pipeDiameterMM}mm` 
    : additionalParams?.pipeDiameterInches 
      ? `${additionalParams.pipeDiameterInches}"` 
      : null;
  const directionInfo = additionalParams?.mainPipeDirection 
    ? capitalize(additionalParams.mainPipeDirection)
    : null;

  const sizeDisplay = location.sizeCategory ? `${capitalize(location.sizeCategory)} Room` : null;
  const areaDisplay = location.areaSqft 
    ? `${location.areaSqft.toLocaleString()} sq ft` 
    : (location.length && location.width 
      ? `${(location.length * location.width).toLocaleString()} sq ft` 
      : null);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className={showDrawing ? "sm:max-w-5xl h-[85vh] flex flex-col p-0" : "sm:max-w-md"}>
        <DialogHeader className="px-6 pt-6 pb-4 border-b flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <span className="text-muted-foreground text-sm">{location.id}:</span>
            {location.areaName || location.name}
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
                    <p className="text-sm font-medium mt-1">{location.category}</p>
                  </div>
                  {location.floor && (
                    <div>
                      <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Floor</label>
                      <p className="text-sm font-medium mt-1">{location.floor}</p>
                    </div>
                  )}
                </div>

                {/* Size & Area */}
                {(sizeDisplay || areaDisplay) && (
                  <div className="grid grid-cols-2 gap-4">
                    {sizeDisplay && (
                      <div>
                        <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Size</label>
                        <p className="text-sm font-medium mt-1">{sizeDisplay}</p>
                      </div>
                    )}
                    {areaDisplay && (
                      <div>
                        <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Area</label>
                        <p className="text-sm font-medium mt-1">{areaDisplay}</p>
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
                {(location.drawingCode || location.fileName) && (
                  <div className="space-y-3">
                    {location.drawingCode && (
                      <div>
                        <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Drawing Code</label>
                        <p className="text-sm font-medium mt-1">{location.drawingCode}</p>
                      </div>
                    )}
                    {location.fileName && (
                      <div>
                        <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Source File</label>
                        <p className="text-sm font-medium mt-1 truncate" title={location.fileName}>{location.fileName}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Controls */}
                {location.controls && location.controls.length > 0 && (
                  <div>
                    <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Recommended Controls</label>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {location.controls.map((control, idx) => (
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
                    <canvas
                      ref={canvasRef}
                      className="max-w-full h-auto rounded shadow-sm"
                    />
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
                <p className="text-sm font-medium mt-1">{location.category}</p>
              </div>
              {location.floor && (
                <div>
                  <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Floor</label>
                  <p className="text-sm font-medium mt-1">{location.floor}</p>
                </div>
              )}
            </div>

            {/* Size & Area */}
            {(sizeDisplay || areaDisplay) && (
              <div className="grid grid-cols-2 gap-4">
                {sizeDisplay && (
                  <div>
                    <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Size</label>
                    <p className="text-sm font-medium mt-1">{sizeDisplay}</p>
                  </div>
                )}
                {areaDisplay && (
                  <div>
                    <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Area</label>
                    <p className="text-sm font-medium mt-1">{areaDisplay}</p>
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
            {(location.drawingCode || location.fileName) && (
              <div className="grid grid-cols-2 gap-4">
                {location.drawingCode && (
                  <div>
                    <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Drawing Code</label>
                    <p className="text-sm font-medium mt-1">{location.drawingCode}</p>
                  </div>
                )}
                {location.fileName && (
                  <div>
                    <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Source File</label>
                    <p className="text-sm font-medium mt-1 truncate">{location.fileName}</p>
                  </div>
                )}
              </div>
            )}

            {/* Controls */}
            {location.controls && location.controls.length > 0 && (
              <div>
                <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Recommended Controls</label>
                <div className="flex flex-wrap gap-1 mt-2">
                  {location.controls.map((control, idx) => (
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
