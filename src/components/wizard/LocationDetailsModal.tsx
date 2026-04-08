import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, ZoomIn, ZoomOut, AlertCircle, ChevronLeft, ChevronRight, FileImage } from "lucide-react";
import { AnalysisItem } from "@/lib/analysisItemMapper";
import { getDrawingImage } from "@/lib/drawingMapper";
import { supabase } from "@/integrations/supabase/client";
import { useMapNavigation } from "@/hooks/useMapNavigation";
import { findBBoxInTextLayer } from "@/lib/pdfTextLayerSearch";
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
  const [baseDimensions, setBaseDimensions] = useState<{ width: number; height: number } | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pageImage, setPageImage] = useState<HTMLImageElement | null>(null);
  const [rawCoords, setRawCoords] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [isAiBBoxMode, setIsAiBBoxMode] = useState(false);
  const [pdfViewport, setPdfViewport] = useState<pdfjsLib.PageViewport | null>(null);
  const [offscreenSize, setOffscreenSize] = useState<{ w: number; h: number } | null>(null);
  // For non-analysis static images (multi-page PDFs from Drive)
  const [staticPageImages, setStaticPageImages] = useState<HTMLImageElement[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const didAutoFitRef = useRef(false);

  const mapNav = useMapNavigation({ zoom, setZoom, minZoom: 1, maxZoom: 8, containerRef });

  // Priority: 1. Analysis source file (from drive-analysis-files bucket), 2. Custom uploaded drawing, 3. Static mapped drawing
  const analysisStoragePath = (location as any)?.drawing_url || (location as any)?.drawingUrl;
  const isAnalysisSource = analysisStoragePath && !analysisStoragePath.startsWith('http') && !analysisStoragePath.startsWith('/');
  const customDrawingUrl = isAnalysisSource ? null : ((location as any)?.drawingUrl || (location as any)?.drawing_url);
  const staticDrawingUrl = (!isAnalysisSource && !customDrawingUrl && location) ? getDrawingImage(location.id) : null;
  const drawingUrl = customDrawingUrl || staticDrawingUrl;
  const showDrawingViewer = !!drawingUrl || !!isAnalysisSource;

  // Load file when modal opens
  useEffect(() => {
    if (isOpen && showDrawingViewer && location) {
      // Reset state
      setPageImage(null);
      setStaticPageImages([]);
      setRawCoords(null);
      setBaseDimensions(null);
      setPdfViewport(null);
      setOffscreenSize(null);
      setError(null);
      setZoom(1);
      setCurrentPage(1);
      setIsAiBBoxMode(false);
      didAutoFitRef.current = false;
      setLoading(true);

      if (isAnalysisSource && analysisStoragePath) {
        loadAnalysisSourceFile(analysisStoragePath, location);
      } else if (drawingUrl) {
        loadStaticImage(drawingUrl);
      } else {
        setLoading(false);
      }
    } else if (!isOpen) {
      setPageImage(null);
      setStaticPageImages([]);
      setRawCoords(null);
      setBaseDimensions(null);
      setPdfViewport(null);
      setOffscreenSize(null);
      setLoading(false);
      setError(null);
    }
  }, [isOpen, showDrawingViewer, location?.id]);

  // Load analysis source file with hybrid bbox approach
  const loadAnalysisSourceFile = async (storagePath: string, loc: AnalysisItem) => {
    try {
      const { data: signedData } = await supabase.storage
        .from('drive-analysis-files')
        .createSignedUrl(storagePath, 3600);
      if (!signedData?.signedUrl) {
        setError("Failed to get signed URL for analysis file");
        setLoading(false);
        return;
      }

      const response = await fetch(signedData.signedUrl);
      if (!response.ok) throw new Error(`Failed to fetch file: ${response.status}`);
      const blob = await response.blob();
      const ab = await blob.arrayBuffer();

      const isPdf = storagePath.toLowerCase().endsWith('.pdf') || blob.type.includes('pdf');
      if (!isPdf) {
        // Image file — no bbox search
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          setPageImage(img);
          setTotalPages(1);
          setLoading(false);
          URL.revokeObjectURL(url);
        };
        img.onerror = () => {
          setError("Failed to load image");
          setLoading(false);
          URL.revokeObjectURL(url);
        };
        img.src = url;
        return;
      }

      const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
      setTotalPages(pdf.numPages);

      // Hybrid bbox: try stored AI coordinates first, then text-layer search
      const storedCoords = loc.coordinates;
      let useAi = false;
      let textBBox: Awaited<ReturnType<typeof findBBoxInTextLayer>> = null;
      let targetPage = 1;

      if (storedCoords && storedCoords.length === 4) {
        // Stored coordinates are AI pixel coordinates
        useAi = true;
        console.log(`[LocationModal] Using stored AI coords:`, storedCoords);
      } else {
        // Fallback: text-layer search using the item ID (e.g. "SWC-B04")
        const searchId = loc.id || loc.areaName || loc.name;
        if (searchId) {
          console.log(`[LocationModal] No stored coords, searching text layer for "${searchId}"`);
          textBBox = await findBBoxInTextLayer(pdf, searchId);
          if (textBBox) {
            console.log(`[LocationModal] Text-layer match found on page ${textBBox.pageNum}:`, textBBox);
            targetPage = textBBox.pageNum;
          }
        }
      }

      // Render the target page at scale 4
      const page = await pdf.getPage(Math.min(targetPage, pdf.numPages));
      const viewport = page.getViewport({ scale: 4 });
      setPdfViewport(viewport);
      setOffscreenSize({ w: viewport.width, h: viewport.height });

      const offscreen = document.createElement("canvas");
      offscreen.width = viewport.width;
      offscreen.height = viewport.height;
      const ctx = offscreen.getContext("2d")!;
      await page.render({ canvasContext: ctx, viewport, canvas: offscreen } as any).promise;

      const img = new Image();
      img.src = offscreen.toDataURL();
      await new Promise<void>((resolve) => { img.onload = () => resolve(); });

      setPageImage(img);

      if (useAi && storedCoords) {
        setRawCoords({ x1: storedCoords[0], y1: storedCoords[1], x2: storedCoords[2], y2: storedCoords[3] });
        setIsAiBBoxMode(true);
      } else if (textBBox) {
        setRawCoords({ x1: textBBox.x1, y1: textBBox.y1, x2: textBBox.x2, y2: textBBox.y2 });
        setIsAiBBoxMode(false);
      }

      setLoading(false);
    } catch (err) {
      console.error("Error loading analysis source file:", err);
      setError(err instanceof Error ? err.message : "Failed to load file");
      setLoading(false);
    }
  };

  // Resolve a drawing URL: convert storage paths or legacy public URLs to signed URLs
  const resolveDrawingUrl = async (url: string): Promise<string> => {
    if (url.startsWith('http')) {
      const awpMatch = url.match(/\/awp-drawings\/(.+?)(\?.*)?$/);
      if (awpMatch) {
        const { data } = await supabase.storage
          .from('awp-drawings')
          .createSignedUrl(awpMatch[1], 3600);
        return data?.signedUrl || url;
      }
      return url;
    }
    const { data } = await supabase.storage
      .from('awp-drawings')
      .createSignedUrl(url, 3600);
    return data?.signedUrl || url;
  };

  // Load static image from public folder or signed URL
  const loadStaticImage = async (url: string) => {
    try {
      const resolvedUrl = await resolveDrawingUrl(url);
      const img = new Image();
      img.onload = () => {
        setPageImage(img);
        setStaticPageImages([img]);
        setTotalPages(1);
        setLoading(false);
      };
      img.onerror = () => {
        setError("Failed to load drawing image");
        setLoading(false);
      };
      img.src = resolvedUrl;
    } catch {
      setError("Failed to resolve drawing URL");
      setLoading(false);
    }
  };

  // Step 2: Compute base dimensions when image loads
  useEffect(() => {
    if (!pageImage || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const containerW = rect.width - 32;
    const containerH = rect.height - 32;
    if (containerW <= 0 || containerH <= 0) return;
    const imgAspect = pageImage.naturalWidth / pageImage.naturalHeight;
    const containerAspect = containerW / containerH;
    let baseW: number, baseH: number;
    if (imgAspect > containerAspect) {
      baseW = containerW;
      baseH = containerW / imgAspect;
    } else {
      baseH = containerH;
      baseW = containerH * imgAspect;
    }
    setBaseDimensions({ width: baseW, height: baseH });
    setZoom(1);
    containerRef.current?.scrollTo({ left: 0, top: 0 });
    didAutoFitRef.current = false;
  }, [pageImage]);

  // Step 3: Draw image + red bounding box overlay onto display canvas
  useEffect(() => {
    if (!pageImage || !baseDimensions || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const w = Math.floor(baseDimensions.width * zoom);
    const h = Math.floor(baseDimensions.height * zoom);
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(pageImage, 0, 0, w, h);

    if (rawCoords && pdfViewport && offscreenSize) {
      let cx: number, cy: number, radius: number;

      if (isAiBBoxMode) {
        // AI pixel coordinates — map directly to display canvas
        const ncx = ((rawCoords.x1 + rawCoords.x2) / 2) / offscreenSize.w;
        const ncy = ((rawCoords.y1 + rawCoords.y2) / 2) / offscreenSize.h;
        const nbw = Math.abs(rawCoords.x2 - rawCoords.x1) / offscreenSize.w;
        const nbh = Math.abs(rawCoords.y2 - rawCoords.y1) / offscreenSize.h;
        cx = ncx * w;
        cy = ncy * h;
        const bw = nbw * w;
        const bh = nbh * h;
        radius = Math.max(bw, bh) / 2 + 20;
        radius = Math.max(radius, 15);
      } else {
        // PDF user-space (pts, origin bottom-left) → offscreen canvas pixels
        const viewportRect = pdfViewport.convertToViewportRectangle([
          rawCoords.x1, rawCoords.y1, rawCoords.x2, rawCoords.y2,
        ]);
        const [vx1, vy1, vx2, vy2] = viewportRect;
        const nx1 = Math.min(vx1, vx2) / offscreenSize.w;
        const ny1 = Math.min(vy1, vy2) / offscreenSize.h;
        const nx2 = Math.max(vx1, vx2) / offscreenSize.w;
        const ny2 = Math.max(vy1, vy2) / offscreenSize.h;
        cx = ((nx1 + nx2) / 2) * w;
        cy = ((ny1 + ny2) / 2) * h;
        const bw = (nx2 - nx1) * w;
        const bh = (ny2 - ny1) * h;
        radius = Math.max(bw, bh) / 2 + 20;
      }

      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(239, 68, 68, 0.12)";
      ctx.fill();
      ctx.strokeStyle = "rgba(239, 68, 68, 0.9)";
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
  }, [pageImage, baseDimensions, zoom, rawCoords, pdfViewport, offscreenSize, isAiBBoxMode]);

  // Step 4: Auto fit-selection — fires once per modal open
  useEffect(() => {
    if (didAutoFitRef.current) return;
    if (!rawCoords || !pdfViewport || !offscreenSize || !baseDimensions) return;
    const container = containerRef.current;
    if (!container) return;

    let bx: number, by: number, radius: number;

    if (isAiBBoxMode) {
      const ncx = ((rawCoords.x1 + rawCoords.x2) / 2) / offscreenSize.w;
      const ncy = ((rawCoords.y1 + rawCoords.y2) / 2) / offscreenSize.h;
      const nbw = Math.abs(rawCoords.x2 - rawCoords.x1) / offscreenSize.w;
      const nbh = Math.abs(rawCoords.y2 - rawCoords.y1) / offscreenSize.h;
      const bw = nbw * baseDimensions.width;
      const bh = nbh * baseDimensions.height;
      radius = Math.max(bw, bh) / 2 + 20;
      radius = Math.max(radius, 15);
      bx = ncx * baseDimensions.width - radius;
      by = ncy * baseDimensions.height - radius;
    } else {
      const [vx1, vy1, vx2, vy2] = pdfViewport.convertToViewportRectangle([
        rawCoords.x1, rawCoords.y1, rawCoords.x2, rawCoords.y2,
      ]);
      const nx1 = Math.min(vx1, vx2) / offscreenSize.w;
      const ny1 = Math.min(vy1, vy2) / offscreenSize.h;
      const nx2 = Math.max(vx1, vx2) / offscreenSize.w;
      const ny2 = Math.max(vy1, vy2) / offscreenSize.h;
      const bw = (nx2 - nx1) * baseDimensions.width;
      const bh = (ny2 - ny1) * baseDimensions.height;
      radius = Math.max(bw, bh) / 2 + 20;
      bx = ((nx1 + nx2) / 2) * baseDimensions.width - radius;
      by = ((ny1 + ny2) / 2) * baseDimensions.height - radius;
    }

    const diameter = radius * 2;
    if (diameter <= 2) return;

    const PADDING = 0.20;
    const fitScale = Math.min(
      container.clientWidth / (diameter * (1 + PADDING)),
      container.clientHeight / (diameter * (1 + PADDING)),
    );
    const targetZoom = Math.min(4.0, Math.max(1.0, fitScale));

    const cx = (bx + radius) * targetZoom;
    const cy = (by + radius) * targetZoom;

    didAutoFitRef.current = true;
    setZoom(targetZoom);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const c = containerRef.current;
        if (!c) return;
        const maxLeft = Math.max(0, c.scrollWidth - c.clientWidth);
        const maxTop = Math.max(0, c.scrollHeight - c.clientHeight);
        const left = Math.min(maxLeft, Math.max(0, cx - c.clientWidth / 2));
        const top = Math.min(maxTop, Math.max(0, cy - c.clientHeight / 2));
        c.scrollTo({ left, top });
      });
    });
  }, [rawCoords, pdfViewport, offscreenSize, baseDimensions]);

  if (!location) return null;

  const capitalize = (str: string) => str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  
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

                {/* Bounding Box info */}
                {rawCoords && (
                  <div>
                    <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Bounding Box</label>
                    <p className="text-xs font-mono text-muted-foreground leading-relaxed mt-1">
                      ({Math.round(rawCoords.x1)}, {Math.round(rawCoords.y1)})<br />
                      → ({Math.round(rawCoords.x2)}, {Math.round(rawCoords.y2)})
                    </p>
                  </div>
                )}

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
            <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
              {/* Fixed zoom toolbar */}
              <div className="h-12 flex-shrink-0 flex items-center justify-between px-4 border-b bg-background">
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
                  <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => {
                    const container = containerRef.current;
                    if (!container) { setZoom(z => Math.max(1, z - 0.25)); return; }
                    const fx = container.scrollWidth > 0 ? (container.scrollLeft + container.clientWidth / 2) / container.scrollWidth : 0.5;
                    const fy = container.scrollHeight > 0 ? (container.scrollTop + container.clientHeight / 2) / container.scrollHeight : 0.5;
                    setZoom(prev => {
                      const nz = Math.max(1, prev - 0.25);
                      requestAnimationFrame(() => { container.scrollLeft = fx * container.scrollWidth - container.clientWidth / 2; container.scrollTop = fy * container.scrollHeight - container.clientHeight / 2; });
                      return nz;
                    });
                  }} disabled={zoom <= 1}>
                    <ZoomOut className="w-4 h-4" />
                  </Button>
                  <span className="text-sm min-w-[3rem] text-center tabular-nums">{Math.round(zoom * 100)}%</span>
                  <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => {
                    const container = containerRef.current;
                    if (!container) { setZoom(z => Math.min(8, z + 0.25)); return; }
                    const fx = container.scrollWidth > 0 ? (container.scrollLeft + container.clientWidth / 2) / container.scrollWidth : 0.5;
                    const fy = container.scrollHeight > 0 ? (container.scrollTop + container.clientHeight / 2) / container.scrollHeight : 0.5;
                    setZoom(prev => {
                      const nz = Math.min(8, prev + 0.25);
                      requestAnimationFrame(() => { container.scrollLeft = fx * container.scrollWidth - container.clientWidth / 2; container.scrollTop = fy * container.scrollHeight - container.clientHeight / 2; });
                      return nz;
                    });
                  }} disabled={zoom >= 8}>
                    <ZoomIn className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              
              {/* Scrollable drawing container with map navigation */}
              <div
                ref={containerRef}
                className="flex-1 min-h-0 overflow-auto bg-muted/30 m-4 border rounded-lg p-4"
                style={mapNav.containerStyle}
                {...mapNav.handlers}
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
                ) : pageImage ? (
                  <div className="flex items-start justify-start min-h-full min-w-full">
                    <canvas ref={canvasRef} className="rounded shadow-sm" style={{ maxWidth: "none", maxHeight: "none" }} />
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
            <div className="rounded-lg bg-muted/50 border-2 border-dashed border-muted-foreground/20 p-6 mb-4">
              <div className="flex flex-col items-center justify-center text-center space-y-2">
                <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center">
                  <FileImage className="w-6 h-6 text-muted-foreground/50" />
                </div>
                <p className="text-sm text-muted-foreground">No drawing associated with this location</p>
              </div>
            </div>
            
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
