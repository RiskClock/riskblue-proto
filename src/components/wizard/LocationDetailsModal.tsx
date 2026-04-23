import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertCircle, FileImage } from "lucide-react";
import { AnalysisItem } from "@/lib/analysisItemMapper";
import { getDrawingImage } from "@/lib/drawingMapper";
import { supabase } from "@/integrations/supabase/client";
import { findBBoxInTextLayer } from "@/lib/pdfTextLayerSearch";
import type { DriveFileInfo } from "./ProjectFilesUpload";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { DrawingViewer } from "@/components/viewer";
import type { DocumentSourceDescriptor, OverlayInput } from "@/components/viewer";

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

/**
 * Resolved overlay descriptor for the shared viewer. Coordinate model:
 *  - "pixels": AI bbox coords are in the scale-4 PDF raster pixel space.
 *  - "pdf-points": text-layer search bbox in PDF user-space (origin bottom-left).
 */
interface ResolvedOverlay {
  pageNum: number;
  bbox: [number, number, number, number];
  coordSpace: "pixels" | "pdf-points";
  pixelSize?: { w: number; h: number };
  pdfViewport?: pdfjsLib.PageViewport;
}

const OVERLAY_ID = "location-bbox";

export const LocationDetailsModal = ({
  isOpen,
  onClose,
  location,
}: LocationDetailsModalProps) => {
  const [resolveLoading, setResolveLoading] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [resolvedSource, setResolvedSource] = useState<DocumentSourceDescriptor | null>(null);
  const [resolvedOverlay, setResolvedOverlay] = useState<ResolvedOverlay | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  // Tracked so we know when to keep `initialFit="selection"` vs reset to page-fit on
  // page-change. (For now we follow legacy behavior: selection-fit only on initial open.)
  const [didInitialFit, setDidInitialFit] = useState(false);

  // Source priority (preserved from prior implementation):
  //  1. Analysis source file (storage path in `drive-analysis-files`) — bbox-aware
  //  2. Custom uploaded drawing (URL or storage path in `awp-drawings`)
  //  3. Static mapped drawing (Vite-imported public asset, path begins with `/`)
  const rawDrawingUrl: string | undefined =
    (location as any)?.drawing_url || (location as any)?.drawingUrl;
  // An analysis-source storage path is a bare relative key (no scheme, no
  // leading slash, no `data:` / `blob:`). Anything else is either a Vite asset
  // (leading `/`), a hosted URL (`http(s)://`), or an inline blob/data URL.
  const isAnalysisSource =
    !!rawDrawingUrl &&
    !rawDrawingUrl.startsWith("http") &&
    !rawDrawingUrl.startsWith("/") &&
    !rawDrawingUrl.startsWith("data:") &&
    !rawDrawingUrl.startsWith("blob:");
  const analysisStoragePath = isAnalysisSource ? rawDrawingUrl : null;
  const customDrawingUrl = isAnalysisSource ? null : rawDrawingUrl;
  const staticDrawingUrl =
    !isAnalysisSource && !customDrawingUrl && location ? getDrawingImage(location.id) : null;
  const drawingUrl = customDrawingUrl || staticDrawingUrl;
  const showDrawingViewer = !!drawingUrl || !!isAnalysisSource;

  // Resolve a non-analysis drawing URL into a usable source descriptor for the
  // shared viewer. Handles every variant the wizard can produce:
  //   - Vite-imported asset path  (e.g. "/assets/drawings/ERM001-abc.png")
  //   - data: / blob: inline URL  (e.g. previewing a freshly uploaded file)
  //   - hosted http(s) URL        (legacy public bucket URL or external)
  //   - bare relative storage key (awp-drawings bucket path)
  const resolveNonAnalysisSource = async (
    url: string
  ): Promise<DocumentSourceDescriptor> => {
    if (url.startsWith("data:") || url.startsWith("blob:")) {
      return { kind: "url", url };
    }
    if (url.startsWith("/")) {
      // Vite/public asset — the dev/prod server serves it directly.
      return { kind: "url", url };
    }
    if (url.startsWith("http")) {
      // Extract a bucket path from legacy public-bucket URLs so signed access
      // still works if the bucket goes private; otherwise fall back to a
      // direct fetch.
      const awpMatch = url.match(/\/awp-drawings\/(.+?)(\?.*)?$/);
      if (awpMatch) {
        return { kind: "supabase-storage", bucket: "awp-drawings", path: awpMatch[1] };
      }
      return { kind: "url", url };
    }
    // Bare relative key → awp-drawings bucket
    return { kind: "supabase-storage", bucket: "awp-drawings", path: url };
  };

  // Resolve source + (when applicable) overlay each time the modal opens.
  useEffect(() => {
    // Reset on close or when there's no drawing.
    if (!isOpen || !showDrawingViewer || !location) {
      setResolvedSource(null);
      setResolvedOverlay(null);
      setResolveError(null);
      setResolveLoading(false);
      setCurrentPage(1);
      setDidInitialFit(false);
      return;
    }

    let cancelled = false;
    setResolveLoading(true);
    setResolveError(null);
    setResolvedSource(null);
    setResolvedOverlay(null);
    setCurrentPage(1);
    setDidInitialFit(false);

    (async () => {
      try {
        if (isAnalysisSource && analysisStoragePath) {
          // Analysis source: PDF (with bbox) or image (no bbox).
          const isPdf = analysisStoragePath.toLowerCase().endsWith(".pdf");
          const source: DocumentSourceDescriptor = {
            kind: "supabase-storage",
            bucket: "drive-analysis-files",
            path: analysisStoragePath,
          };

          if (!isPdf) {
            // Image — no bbox resolution required.
            if (!cancelled) {
              setResolvedSource(source);
              setResolveLoading(false);
            }
            return;
          }

          // PDF — download once to resolve bbox + page metadata for the overlay.
          // The shared viewer will download/raster the same blob; both go through
          // the storage cache so the overhead is acceptable. (Alternatively we
          // could expose per-page metadata from the viewer, but keeping the
          // resolution local keeps the viewer surface narrow.)
          const { data: signed } = await supabase.storage
            .from("drive-analysis-files")
            .createSignedUrl(analysisStoragePath, 3600);
          if (!signed?.signedUrl) throw new Error("Failed to sign analysis file URL");
          const r = await fetch(signed.signedUrl);
          if (!r.ok) throw new Error(`Failed to fetch file: ${r.status}`);
          const blob = await r.blob();
          const ab = await blob.arrayBuffer();
          if (cancelled) return;

          const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
          if (cancelled) return;

          const storedCoords = location.coordinates;
          let textBBox: Awaited<ReturnType<typeof findBBoxInTextLayer>> = null;
          let targetPage = 1;
          let useAi = false;

          if (storedCoords && storedCoords.length === 4) {
            useAi = true;
            console.log(`[LocationModal] Using stored AI coords:`, storedCoords);
          } else {
            const candidates: string[] = [];
            if (location.id) candidates.push(location.id);
            if ((location as any).drawingCode) candidates.push((location as any).drawingCode);
            if (location.areaName) candidates.push(location.areaName);
            if (location.name) candidates.push(location.name);
            console.log(
              `[LocationModal] No stored coords, searching text layer with candidates:`,
              candidates
            );
            for (const candidate of candidates) {
              textBBox = await findBBoxInTextLayer(pdf, candidate);
              if (textBBox) {
                console.log(
                  `[LocationModal] Text-layer match found for "${candidate}" on page ${textBBox.pageNum}:`,
                  textBBox
                );
                targetPage = textBBox.pageNum;
                break;
              }
              if (cancelled) return;
            }
          }

          // Fetch the matching page's viewport (used for both pixel-space and pdf-points
          // overlays so the viewer can convert into normalized coords correctly).
          const pageNum = Math.min(targetPage, pdf.numPages);
          const page = await pdf.getPage(pageNum);
          if (cancelled) return;
          const viewport = page.getViewport({ scale: 4 });

          if (cancelled) return;

          if (useAi && storedCoords) {
            setResolvedOverlay({
              pageNum,
              bbox: [storedCoords[0], storedCoords[1], storedCoords[2], storedCoords[3]],
              coordSpace: "pixels",
              pixelSize: { w: viewport.width, h: viewport.height },
            });
          } else if (textBBox) {
            setResolvedOverlay({
              pageNum,
              bbox: [textBBox.x1, textBBox.y1, textBBox.x2, textBBox.y2],
              coordSpace: "pdf-points",
              pdfViewport: viewport,
            });
          }
          setCurrentPage(pageNum);
          setResolvedSource(source);
          setResolveLoading(false);
        } else if (drawingUrl) {
          // Static / custom drawing: resolve into a DocumentSourceDescriptor.
          const source = await resolveNonAnalysisSource(drawingUrl);
          if (!cancelled) {
            setResolvedSource(source);
            setResolveLoading(false);
          }
        } else {
          if (!cancelled) setResolveLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          console.error("[LocationModal] resolve error:", e);
          setResolveError(e instanceof Error ? e.message : "Failed to load drawing");
          setResolveLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, showDrawingViewer, location?.id]);

  // Build the single overlay for the viewer (only for analysis-source PDFs with bbox).
  // Exact-location emphasis → use a translucent circle marker (not a region rect).
  const overlays: OverlayInput[] = useMemo(() => {
    if (!resolvedOverlay) return [];
    return [
      {
        id: OVERLAY_ID,
        page: resolvedOverlay.pageNum,
        bbox: resolvedOverlay.bbox,
        coordSpace: resolvedOverlay.coordSpace,
        pixelSize: resolvedOverlay.pixelSize,
        pdfViewport: resolvedOverlay.pdfViewport,
        color: "hsl(var(--destructive))",
        label: location?.id,
        shape: "circle",
      },
    ];
  }, [resolvedOverlay, location?.id]);

  const bboxReadout = resolvedOverlay
    ? `(${Math.round(resolvedOverlay.bbox[0])}, ${Math.round(resolvedOverlay.bbox[1])}) → (${Math.round(resolvedOverlay.bbox[2])}, ${Math.round(resolvedOverlay.bbox[3])})`
    : null;

  if (!location) return null;

  const capitalize = (str: string) =>
    str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();

  const additionalParams = (location as any).additionalParameters;
  const pipeInfo = additionalParams?.pipeDiameterInches
    ? `${additionalParams.pipeDiameterInches}"`
    : additionalParams?.pipeDiameterMM
    ? `${Math.round(additionalParams.pipeDiameterMM / 25.4)}"`
    : null;
  const directionInfo = additionalParams?.mainPipeDirection
    ? capitalize(additionalParams.mainPipeDirection)
    : null;

  const sizeDisplay = location.sizeCategory
    ? `${capitalize(location.sizeCategory)} Room`
    : null;
  const areaDisplay = location.areaSqft
    ? `${location.areaSqft.toLocaleString()} ft²`
    : location.length && location.width
    ? `${(location.length * location.width).toLocaleString()} ft²`
    : null;

  // Decide initial fit. Selection-fit only when we actually have a resolved overlay
  // AND the modal hasn't already auto-fit once. After page-change we drop to page-fit
  // (legacy behavior was to keep the bbox view only on initial open).
  const initialFit: "selection" | "page" =
    resolvedOverlay && !didInitialFit ? "selection" : "page";

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        className={
          showDrawingViewer
            ? "sm:max-w-5xl h-[85vh] flex flex-col p-0"
            : "sm:max-w-md"
        }
      >
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
                    <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                      Category
                    </label>
                    <p className="text-sm font-medium mt-1">{location.category}</p>
                  </div>
                  {location.floor && (
                    <div>
                      <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                        Floor
                      </label>
                      <p className="text-sm font-medium mt-1">{location.floor}</p>
                    </div>
                  )}
                </div>

                {(sizeDisplay || areaDisplay) && (
                  <div className="grid grid-cols-2 gap-4">
                    {sizeDisplay && (
                      <div>
                        <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                          Size
                        </label>
                        <p className="text-sm font-medium mt-1">{sizeDisplay}</p>
                      </div>
                    )}
                    {areaDisplay && (
                      <div>
                        <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                          Area
                        </label>
                        <p className="text-sm font-medium mt-1">{areaDisplay}</p>
                      </div>
                    )}
                  </div>
                )}

                {(pipeInfo || directionInfo) && (
                  <div className="grid grid-cols-2 gap-4">
                    {pipeInfo && (
                      <div>
                        <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                          Pipe Diameter
                        </label>
                        <p className="text-sm font-medium mt-1">{pipeInfo}</p>
                      </div>
                    )}
                    {directionInfo && (
                      <div>
                        <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                          Pipe Direction
                        </label>
                        <p className="text-sm font-medium mt-1">{directionInfo}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Bounding Box info */}
                {bboxReadout && (
                  <div>
                    <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                      Bounding Box
                    </label>
                    <p className="text-xs font-mono text-muted-foreground leading-relaxed mt-1">
                      {bboxReadout}
                    </p>
                  </div>
                )}

                {(location.drawingCode || location.fileName) && (
                  <div className="space-y-3">
                    {location.drawingCode && (
                      <div>
                        <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                          Drawing Code
                        </label>
                        <p className="text-sm font-medium mt-1">{location.drawingCode}</p>
                      </div>
                    )}
                    {location.fileName && (
                      <div>
                        <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                          Source File
                        </label>
                        <p
                          className="text-sm font-medium mt-1 truncate"
                          title={location.fileName}
                        >
                          {location.fileName}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {location.controls && location.controls.length > 0 && (
                  <div>
                    <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                      Recommended Controls
                    </label>
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

            {/* Right side - shared DrawingViewer */}
            <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
              {resolveLoading ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center space-y-2">
                    <Loader2 className="w-8 h-8 animate-spin text-muted-foreground mx-auto" />
                    <p className="text-sm text-muted-foreground">Loading drawing...</p>
                  </div>
                </div>
              ) : resolveError ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center space-y-2">
                    <AlertCircle className="w-8 h-8 text-destructive mx-auto" />
                    <p className="text-sm text-destructive">{resolveError}</p>
                  </div>
                </div>
              ) : resolvedSource ? (
                <DrawingViewer
                  source={resolvedSource}
                  layout="single-page"
                  page={currentPage}
                  onPageChange={(p) => {
                    setCurrentPage(p);
                    // Once the user navigates pages, drop selection-fit so subsequent
                    // re-mounts of the viewer don't re-zoom to a bbox on a different page.
                    setDidInitialFit(true);
                  }}
                  overlays={overlays}
                  initialFit={initialFit}
                  initialFitOverlayId={
                    resolvedOverlay && !didInitialFit ? OVERLAY_ID : undefined
                  }
                  minScale={0.5}
                  maxScale={8}
                />
              ) : (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center space-y-3">
                    <div className="w-20 h-20 mx-auto rounded-lg bg-muted flex items-center justify-center">
                      <FileImage className="w-10 h-10 text-muted-foreground/50" />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      No drawing associated with this location
                    </p>
                  </div>
                </div>
              )}
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
                <p className="text-sm text-muted-foreground">
                  No drawing associated with this location
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                  Category
                </label>
                <p className="text-sm font-medium mt-1">{location.category}</p>
              </div>
              {location.floor && (
                <div>
                  <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                    Floor
                  </label>
                  <p className="text-sm font-medium mt-1">{location.floor}</p>
                </div>
              )}
            </div>

            {(sizeDisplay || areaDisplay) && (
              <div className="grid grid-cols-2 gap-4">
                {sizeDisplay && (
                  <div>
                    <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                      Size
                    </label>
                    <p className="text-sm font-medium mt-1">{sizeDisplay}</p>
                  </div>
                )}
                {areaDisplay && (
                  <div>
                    <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                      Area
                    </label>
                    <p className="text-sm font-medium mt-1">{areaDisplay}</p>
                  </div>
                )}
              </div>
            )}

            {(pipeInfo || directionInfo) && (
              <div className="grid grid-cols-2 gap-4">
                {pipeInfo && (
                  <div>
                    <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                      Pipe Diameter
                    </label>
                    <p className="text-sm font-medium mt-1">{pipeInfo}</p>
                  </div>
                )}
                {directionInfo && (
                  <div>
                    <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                      Pipe Direction
                    </label>
                    <p className="text-sm font-medium mt-1">{directionInfo}</p>
                  </div>
                )}
              </div>
            )}

            {(location.drawingCode || location.fileName) && (
              <div className="grid grid-cols-2 gap-4">
                {location.drawingCode && (
                  <div>
                    <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                      Drawing Code
                    </label>
                    <p className="text-sm font-medium mt-1">{location.drawingCode}</p>
                  </div>
                )}
                {location.fileName && (
                  <div>
                    <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                      Source File
                    </label>
                    <p className="text-sm font-medium mt-1 truncate">{location.fileName}</p>
                  </div>
                )}
              </div>
            )}

            {location.controls && location.controls.length > 0 && (
              <div>
                <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                  Recommended Controls
                </label>
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
