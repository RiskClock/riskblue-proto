import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, ZoomIn, ZoomOut, RotateCw, AlertCircle, ChevronLeft, ChevronRight, FileImage } from "lucide-react";
import { AnalysisItem } from "@/lib/analysisItemMapper";
import { getDrawingImage } from "@/lib/drawingMapper";
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

  // Priority: 1. Custom uploaded drawing, 2. Static mapped drawing (only for analysis-created items)
  const customDrawingUrl = (location as any)?.drawingUrl || (location as any)?.drawing_url;
  const isFromAnalysis = (location as any)?.source === 'analysis';
  const staticDrawingUrl = (location && isFromAnalysis) ? getDrawingImage(location.id) : null;
  const drawingUrl = customDrawingUrl || staticDrawingUrl;
  const showDrawingViewer = !!drawingUrl;

  // Load file when modal opens - single consolidated effect
  useEffect(() => {
    if (isOpen && showDrawingViewer && drawingUrl) {
      // Reset state and load fresh
      setPageImages([]);
      setOriginalSize(null);
      setError(null);
      setZoom(1);
      setCurrentPage(1);
      setLoading(true);
      
      loadStaticImage(drawingUrl);
    } else if (!isOpen) {
      // Cleanup on close
      setPageImages([]);
      setOriginalSize(null);
      setLoading(false);
      setError(null);
    }
  }, [isOpen, showDrawingViewer, location, drawingUrl]);

  // Load static image from public folder
  const loadStaticImage = (url: string) => {
    const img = new Image();
    img.onload = () => {
      setPageImages([img]);
      setTotalPages(1);
      setOriginalSize({ width: img.naturalWidth, height: img.naturalHeight });
      setLoading(false);
    };
    img.onerror = () => {
      setError("Failed to load drawing image");
      setLoading(false);
    };
    img.src = url;
  };

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
          const scale = 4; // Higher resolution for detailed drawings
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

    // Use natural image dimensions for proper zoom behavior
    const imgWidth = img.naturalWidth || img.width;
    const imgHeight = img.naturalHeight || img.height;
    const imgAspect = imgWidth / imgHeight;
    const containerAspect = containerWidth / containerHeight;

    // Calculate base dimensions to fit container at 100% zoom
    let baseWidth: number;
    let baseHeight: number;

    if (imgAspect > containerAspect) {
      baseWidth = containerWidth;
      baseHeight = containerWidth / imgAspect;
    } else {
      baseHeight = containerHeight;
      baseWidth = containerHeight * imgAspect;
    }

    // Apply zoom to the base dimensions
    const displayWidth = Math.floor(baseWidth * zoom);
    const displayHeight = Math.floor(baseHeight * zoom);

    canvas.width = displayWidth;
    canvas.height = displayHeight;

    // Draw at higher quality
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, displayWidth, displayHeight);
  }, [pageImages, currentPage, zoom, loading]);

  if (!location) return null;

  const capitalize = (str: string) => str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  
  // Get additional parameters if available (display in inches)
  const additionalParams = (location as any).additionalParameters;
  const pipeInfo = additionalParams?.pipeDiameterInches 
    ? `${additionalParams.pipeDiameterInches}"` 
    : additionalParams?.pipeDiameterMM 
      ? `${Math.round(additionalParams.pipeDiameterMM / 25.4)}"` 
      : null;
  const directionInfo = additionalParams?.mainPipeDirection 
    ? capitalize(additionalParams.mainPipeDirection)
    : null;

  const sizeDisplay = location.sizeCategory ? `${capitalize(location.sizeCategory)} Room` : null;
  const areaDisplay = location.areaSqft 
    ? `${location.areaSqft.toLocaleString()} ft²` 
    : (location.length && location.width 
      ? `${(location.length * location.width).toLocaleString()} ft²`
      : null);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className={showDrawingViewer ? "sm:max-w-5xl h-[85vh] flex flex-col p-0" : "sm:max-w-md"}>
        <DialogHeader className="px-6 pt-6 pb-4 border-b flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <span className="text-muted-foreground text-sm">{location.id}:</span>
            {location.areaName || location.name}
          </DialogTitle>
        </DialogHeader>
        
        {showDrawingViewer ? (
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
            <div className="flex-1 flex flex-col min-h-0 p-4 relative">
              {/* Floating zoom controls */}
              <div className="absolute top-6 right-6 z-10 flex items-center gap-2 bg-background/95 backdrop-blur-sm border rounded-lg p-2 shadow-sm">
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
                ) : pageImages.length > 0 ? (
                  <div className="flex items-start justify-start min-h-full min-w-full">
                    <canvas
                      ref={canvasRef}
                      className="rounded shadow-sm"
                      style={{ maxWidth: 'none', maxHeight: 'none' }}
                    />
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center space-y-3">
                      <div className="w-20 h-20 mx-auto rounded-lg bg-muted flex items-center justify-center">
                        <FileImage className="w-10 h-10 text-muted-foreground/50" />
                      </div>
                      <p className="text-sm text-muted-foreground">No drawing associated with this location</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* Non-drawing view with placeholder */
          <div className="space-y-4 p-6">
            {/* Grey placeholder for items without drawings */}
            <div className="rounded-lg bg-muted/50 border-2 border-dashed border-muted-foreground/20 p-6 mb-4">
              <div className="flex flex-col items-center justify-center text-center space-y-2">
                <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center">
                  <FileImage className="w-6 h-6 text-muted-foreground/50" />
                </div>
                <p className="text-sm text-muted-foreground">No drawing associated with this location</p>
              </div>
            </div>
            
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
