import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { AnalysisItem } from "@/lib/analysisItemMapper";

interface InstanceDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  instance: AnalysisItem | null;
}

export const InstanceDetailsModal = ({ isOpen, onClose, instance }: InstanceDetailsModalProps) => {
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="text-muted-foreground text-sm">{instance.id}:</span>
            {instance.areaName || instance.name}
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
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
                  <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Actual Dimensions</label>
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
      </DialogContent>
    </Dialog>
  );
};
