import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, ZoomIn, ZoomOut, RotateCw } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

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
  fileUrl: string;
  fileName: string;
  detections: SystemDetection[];
}

// Color map for different system types
const getSystemColor = (systemType: string): string => {
  const type = systemType.toLowerCase();
  if (type.includes("cold water")) return "#3b82f6"; // blue
  if (type.includes("hot water")) return "#ef4444"; // red
  if (type.includes("fire") || type.includes("sprinkler")) return "#f97316"; // orange
  if (type.includes("storm") || type.includes("rain")) return "#8b5cf6"; // purple
  if (type.includes("sanitary")) return "#84cc16"; // lime
  if (type.includes("gas")) return "#eab308"; // yellow
  if (type.includes("condensate")) return "#06b6d4"; // cyan
  return "#6b7280"; // gray default
};

export const FileViewerModal = ({
  isOpen,
  onClose,
  fileUrl,
  fileName,
  detections,
}: FileViewerModalProps) => {
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [hoveredSystem, setHoveredSystem] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    if (isOpen && fileUrl) {
      setLoading(true);
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        imageRef.current = img;
        setImageSize({ width: img.width, height: img.height });
        setLoading(false);
        drawCanvas();
      };
      img.onerror = () => {
        setLoading(false);
      };
      img.src = fileUrl;
    }
  }, [isOpen, fileUrl]);

  useEffect(() => {
    drawCanvas();
  }, [zoom, hoveredSystem, detections]);

  const drawCanvas = () => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const scaledWidth = img.width * zoom;
    const scaledHeight = img.height * zoom;
    
    canvas.width = scaledWidth;
    canvas.height = scaledHeight;

    // Draw image
    ctx.drawImage(img, 0, 0, scaledWidth, scaledHeight);

    // Draw bounding boxes for each detection
    detections.forEach((detection) => {
      const [x1, y1, x2, y2] = detection.coordinates;
      const color = getSystemColor(detection.systemType);
      
      // Scale coordinates
      const scaledX1 = x1 * zoom;
      const scaledY1 = y1 * zoom;
      const scaledX2 = x2 * zoom;
      const scaledY2 = y2 * zoom;
      const width = scaledX2 - scaledX1;
      const height = scaledY2 - scaledY1;

      // Draw rectangle
      ctx.strokeStyle = color;
      ctx.lineWidth = hoveredSystem === detection.lineCode ? 4 : 2;
      ctx.strokeRect(scaledX1, scaledY1, width, height);

      // Draw semi-transparent fill
      ctx.fillStyle = `${color}20`;
      ctx.fillRect(scaledX1, scaledY1, width, height);

      // Draw label background
      const label = detection.lineCode || detection.systemType;
      ctx.font = `${Math.max(12, 14 * zoom)}px sans-serif`;
      const textMetrics = ctx.measureText(label);
      const textHeight = 16 * zoom;
      const padding = 4 * zoom;

      ctx.fillStyle = color;
      ctx.fillRect(
        scaledX1,
        scaledY1 - textHeight - padding * 2,
        textMetrics.width + padding * 2,
        textHeight + padding * 2
      );

      // Draw label text
      ctx.fillStyle = "#ffffff";
      ctx.fillText(label, scaledX1 + padding, scaledY1 - padding);
    });
  };

  const handleZoomIn = () => setZoom((z) => Math.min(z + 0.25, 3));
  const handleZoomOut = () => setZoom((z) => Math.max(z - 0.25, 0.25));
  const handleResetZoom = () => setZoom(1);

  // Filter detections for this file
  const fileDetections = detections.filter(
    (d) => !d.fileName || d.fileName.toLowerCase().includes(fileName.toLowerCase().split('.')[0])
  );

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span className="truncate max-w-md">{fileName}</span>
            <div className="flex items-center gap-2">
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

        <div className="flex flex-1 gap-4 overflow-hidden">
          {/* Canvas area */}
          <ScrollArea className="flex-1 border rounded-lg">
            <div className="p-4">
              {loading ? (
                <div className="flex items-center justify-center h-64">
                  <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <canvas ref={canvasRef} className="max-w-full" />
              )}
            </div>
          </ScrollArea>

          {/* Legend sidebar */}
          {fileDetections.length > 0 && (
            <div className="w-64 border rounded-lg p-3 space-y-2">
              <h4 className="text-sm font-medium">Detected Systems</h4>
              <ScrollArea className="h-full max-h-[calc(90vh-12rem)]">
                <div className="space-y-2 pr-2">
                  {fileDetections.map((detection, i) => (
                    <div
                      key={i}
                      className="p-2 rounded-md border cursor-pointer transition-colors hover:bg-muted/50"
                      style={{
                        borderLeftWidth: 4,
                        borderLeftColor: getSystemColor(detection.systemType),
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
