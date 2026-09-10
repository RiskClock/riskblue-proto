import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DrawingViewer } from "@/components/viewer";
import type { DocumentSourceDescriptor, OverlayInput } from "@/components/viewer";
import type { RotationDeg } from "@/components/viewer/viewerGeometry";
import { getAWPClassColor } from "@/lib/awpColor";

export interface ControlInstance {
  id: string;
  name: string;
  nx: number | null;
  ny: number | null;
  instanceLabel: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  source: DocumentSourceDescriptor | null;
  fileName: string;
  pageIndex: number;
  controlName: string;
  spaceName: string;
  instances: ControlInstance[];
  excludedIds: Set<string>;
  onToggle: (instanceId: string) => void;
  readOnly?: boolean;
}

const OFF_COLOR = "#9CA3AF";

/**
 * Lightweight review modal for a control applied to a set of detections.
 * Reuses the shared DrawingViewer (page + toolbar + annotation overlays) but
 * shows no floor-plan or detection side panels. Clicking an annotation toggles
 * the control on/off for that instance.
 */
export function ControlInstancesModal({
  isOpen,
  onClose,
  source,
  fileName,
  pageIndex,
  controlName,
  spaceName,
  instances,
  excludedIds,
  onToggle,
  readOnly = false,
}: Props) {
  const [rotation, setRotation] = useState<RotationDeg>(0);
  const [hovered, setHovered] = useState<string | null>(null);

  const overlays: OverlayInput[] = useMemo(
    () =>
      instances
        .filter((i) => typeof i.nx === "number" && typeof i.ny === "number")
        .map((i) => {
          const off = excludedIds.has(i.id);
          return {
            id: i.id,
            bbox: [i.nx as number, i.ny as number, 0, 0],
            coordSpace: "normalized" as const,
            page: 1,
            shape: "circle" as const,
            color: off ? OFF_COLOR : getAWPClassColor(i.name),
            label: i.instanceLabel,
          };
        }),
    [instances, excludedIds],
  );

  const onCount = instances.filter((i) => !excludedIds.has(i.id)).length;

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-[95vw] w-[95vw] h-[92vh] p-0 flex flex-col gap-0 overflow-hidden"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader className="px-4 py-3 border-b space-y-1">
          <DialogTitle className="text-base truncate">
            {controlName} — {spaceName}
          </DialogTitle>
          <p className="text-xs text-muted-foreground truncate">
            {fileName} | Page {pageIndex} · {onCount} of {instances.length} locations included
            {readOnly ? "" : " · click an annotation to include or exclude it"}
          </p>
        </DialogHeader>

        <div className="flex-1 min-h-0">
          <DrawingViewer
            source={source}
            layout="single-page"
            page={1}
            overlays={overlays}
            initialFit="page"
            showToolbar
            hidePageNav
            rotation={rotation}
            onRotate={() => setRotation(((rotation + 90) % 360) as RotationDeg)}
            hoveredOverlayId={hovered}
            onOverlayHoverChange={setHovered}
            onOverlayClick={(id) => {
              if (!readOnly) onToggle(id);
            }}
            className="h-full"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
