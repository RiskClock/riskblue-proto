import { useEffect, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Maximize2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { RotateOrientIcon } from "@/assets/icons/RotateOrient";

export interface ViewerToolbarProps {
  scale: number;
  minScale: number;
  maxScale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  onFitPage?: () => void;
  onFitSelection?: () => void;
  /**
   * When set, a Download icon button is rendered in the same slot as
   * `onFitPage`, replacing the fit-page button. Used by the drawing modal
   * to expose per-page vector-PDF download.
   */
  onDownload?: () => void;
  /** Rotation in degrees CW (0/90/180/270). Colors the rotate button when != 0. */
  rotation?: 0 | 90 | 180 | 270;
  /** Advance rotation 90° CW. When set, renders a rotate button. */
  onRotate?: () => void;
  pageNav?: {
    current: number;
    total: number;
    onPrev: () => void;
    onNext: () => void;
    onJump?: (page: number) => void;
  };
}

export const ViewerToolbar = ({
  scale,
  onZoomIn,
  onZoomOut,
  onFitPage,
  onFitSelection,
  onDownload,
  rotation = 0,
  onRotate,
  pageNav,
}: ViewerToolbarProps) => {

  const [jumpValue, setJumpValue] = useState<string>(
    pageNav ? String(pageNav.current) : "",
  );

  // Keep input in sync when external page changes (prev/next/programmatic).
  useEffect(() => {
    if (pageNav) setJumpValue(String(pageNav.current));
  }, [pageNav?.current]);

  const commitJump = () => {
    if (!pageNav?.onJump) return;
    const n = parseInt(jumpValue, 10);
    if (!Number.isFinite(n)) {
      setJumpValue(String(pageNav.current));
      return;
    }
    const clamped = Math.max(1, Math.min(pageNav.total, n));
    if (clamped !== pageNav.current) pageNav.onJump(clamped);
    setJumpValue(String(clamped));
  };

  const onJumpKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitJump();
      (e.target as HTMLInputElement).blur();
    } else if (e.key === "Escape") {
      setJumpValue(String(pageNav?.current ?? ""));
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <div className="flex items-center gap-2">
      {pageNav && pageNav.total > 1 && (
        <>
          <Button
            variant="outline"
            size="icon"
            onClick={pageNav.onPrev}
            disabled={pageNav.current === 1}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm min-w-[5rem] text-center">
            Page {pageNav.current} / {pageNav.total}
          </span>
          <Button
            variant="outline"
            size="icon"
            onClick={pageNav.onNext}
            disabled={pageNav.current === pageNav.total}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
          {pageNav.onJump && (
            <div className="flex items-center gap-1 ml-1">
              <span className="text-xs text-muted-foreground">Go to</span>
              <Input
                type="number"
                min={1}
                max={pageNav.total}
                value={jumpValue}
                onChange={(e) => setJumpValue(e.target.value)}
                onBlur={commitJump}
                onKeyDown={onJumpKeyDown}
                className="h-8 w-16 text-sm"
                aria-label="Jump to page"
              />
            </div>
          )}
          <div className="w-px h-6 bg-border mx-1" />
        </>
      )}
      <Button variant="outline" size="icon" onClick={onZoomOut}>
        <ZoomOut className="w-4 h-4" />
      </Button>
      <span className="text-sm min-w-[4rem] text-center">
        {Math.round(scale * 100)}%
      </span>
      <Button variant="outline" size="icon" onClick={onZoomIn}>
        <ZoomIn className="w-4 h-4" />
      </Button>
      {onRotate && (
        <Button
          variant="outline"
          size="icon"
          onClick={onRotate}
          title={rotation ? `Rotated ${rotation}° — click to rotate again` : "Rotate 90°"}
          style={
            rotation
              ? {
                  backgroundColor: "#6C3BAA",
                  borderColor: "#6C3BAA",
                  color: "#ffffff",
                }
              : undefined
          }
        >
          <RotateCw className="w-4 h-4" style={rotation ? { color: "#ffffff" } : undefined} />
        </Button>
      )}
      {onDownload ? (
        <Button variant="outline" size="icon" onClick={onDownload} title="Download page">
          <Download className="w-4 h-4" />
        </Button>
      ) : onFitPage && (
        <Button variant="outline" size="icon" onClick={onFitPage} title="Fit page">
          <Maximize2 className="w-4 h-4" />
        </Button>
      )}

      {onFitSelection && (
        <Button
          variant="outline"
          size="sm"
          onClick={onFitSelection}
          title="Fit Detection"
        >
          Fit Detection
        </Button>
      )}
    </div>
  );
};
