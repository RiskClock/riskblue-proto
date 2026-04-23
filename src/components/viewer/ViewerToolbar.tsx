import { Button } from "@/components/ui/button";
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  RotateCw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

export interface ViewerToolbarProps {
  scale: number;
  minScale: number;
  maxScale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  onFitPage?: () => void;
  onFitSelection?: () => void;
  pageNav?: {
    current: number;
    total: number;
    onPrev: () => void;
    onNext: () => void;
  };
}

export const ViewerToolbar = ({
  scale,
  onZoomIn,
  onZoomOut,
  onReset,
  onFitPage,
  onFitSelection,
  pageNav,
}: ViewerToolbarProps) => {
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
      {onFitPage && (
        <Button variant="outline" size="icon" onClick={onFitPage} title="Fit page">
          <Maximize2 className="w-4 h-4" />
        </Button>
      )}
      {onFitSelection && (
        <Button
          variant="outline"
          size="sm"
          onClick={onFitSelection}
          title="Fit selection"
        >
          Fit selection
        </Button>
      )}
      <Button variant="outline" size="icon" onClick={onReset} title="Reset">
        <RotateCw className="w-4 h-4" />
      </Button>
    </div>
  );
};
