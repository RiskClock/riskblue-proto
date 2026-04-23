import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DrawingViewer } from "@/components/viewer";
import type {
  DocumentSourceDescriptor,
  OverlayInput,
} from "@/components/viewer";

interface SystemDetection {
  lineMonitored: string;
  lineCode: string;
  systemType: string;
  // [x0, y0, x1, y1] in PDF points OR [x, y, w, h] normalized 0..1
  coordinates: [number, number, number, number];
  fileName?: string;
}

/**
 * Non-Drive source override. When provided, the modal skips the Drive descriptor
 * and feeds this directly to the shared viewer. Used for QA / preview testing
 * without requiring a connected Google Drive account.
 *
 * Example:
 *   <FileViewerModal
 *     ...
 *     sourceOverride={{ kind: "supabase-storage", bucket: "uploaded-drawings", path }}
 *   />
 */
interface FileViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  fileId: string;
  fileName: string;
  mimeType: string;
  accessToken: string;
  detections: SystemDetection[];
  /** Optional: bypass Drive and use any source descriptor supported by useDocumentSource. */
  sourceOverride?: DocumentSourceDescriptor;
}

const BOUNDING_BOX_COLOR = "#39FF14"; // highlighter green

export const FileViewerModal = ({
  isOpen,
  onClose,
  fileId,
  fileName,
  mimeType,
  accessToken,
  detections,
  sourceOverride,
}: FileViewerModalProps) => {
  const [hoveredCode, setHoveredCode] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  // Build the source descriptor for the shared viewer.
  // Priority: explicit override (QA / non-Drive flows) → Drive download.
  const source: DocumentSourceDescriptor | null = useMemo(() => {
    if (!isOpen) return null;
    if (sourceOverride) return sourceOverride;
    if (!fileId || !accessToken) return null;
    return {
      kind: "drive",
      fileId,
      accessToken,
      mimeType,
      fileName,
    };
  }, [isOpen, sourceOverride, fileId, accessToken, mimeType, fileName]);

  // Convert legacy detection coordinates into the shared viewer's overlay model.
  // Detection coords are either normalized 0..1 [x,y,w,h] or PDF points [x1,y1,x2,y2].
  // Bounding-box detections are page-1 in the legacy renderer; preserve that.
  const overlays: OverlayInput[] = useMemo(() => {
    return detections.map((d, i) => {
      const coords = d.coordinates;
      const maxCoord = Math.max(...coords);
      const isNormalizedXYWH = maxCoord <= 1;
      return {
        id: `det-${i}-${d.lineCode}`,
        bbox: coords,
        coordSpace: isNormalizedXYWH ? "normalized" : "pdf-points",
        page: 1,
        color: BOUNDING_BOX_COLOR,
        label: d.lineCode || d.systemType,
      };
    });
  }, [detections]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-[95vw] w-[95vw] h-[90vh] flex flex-col p-4 [&>button]:top-4 [&>button]:right-4">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="truncate">{fileName}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-1 gap-4 overflow-hidden min-h-0">
          {/* Main viewer */}
          <div className="flex-1 border rounded-lg overflow-hidden bg-muted/30 min-h-0">
            <DrawingViewer
              source={source}
              layout="single-page"
              page={currentPage}
              onPageChange={setCurrentPage}
              overlays={overlays}
              hoveredOverlayId={
                hoveredCode
                  ? overlays.find((o) =>
                      o.id.endsWith(`-${hoveredCode}`)
                    )?.id ?? null
                  : null
              }
              initialFit="page"
              minScale={0.5}
              maxScale={8}
            />
          </div>

          {/* Legend sidebar */}
          {detections.length > 0 && (
            <div className="w-64 flex-shrink-0 border rounded-lg p-3 flex flex-col">
              <h4 className="text-sm font-medium mb-2">
                Detected Systems ({detections.length})
              </h4>
              <ScrollArea className="flex-1">
                <div className="space-y-2 pr-2">
                  {detections.map((detection, i) => (
                    <div
                      key={i}
                      className="p-2 rounded-md border cursor-pointer transition-colors hover:bg-muted/50"
                      style={{
                        borderLeftWidth: 4,
                        borderLeftColor: BOUNDING_BOX_COLOR,
                        backgroundColor:
                          hoveredCode === detection.lineCode
                            ? "hsl(var(--muted))"
                            : undefined,
                      }}
                      onMouseEnter={() => setHoveredCode(detection.lineCode)}
                      onMouseLeave={() => setHoveredCode(null)}
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
