import { useState, useEffect, useRef, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Shield, ChevronRight } from "lucide-react";
import { AnalysisItem } from "@/lib/analysisItemMapper";

interface MitigationControlsStepProps {
  data: any;
  onNext: (data: any) => void;
  onBack: () => void;
  isProcessingWebhook?: boolean;
  analysisItems?: AnalysisItem[];
}

interface UniqueControl {
  name: string;
  protectedItems: AnalysisItem[];
}

export const MitigationControlsStep = ({ 
  data, 
  onNext, 
  onBack, 
  isProcessingWebhook,
  analysisItems = []
}: MitigationControlsStepProps) => {
  const [selectedControl, setSelectedControl] = useState<UniqueControl | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const hasPendingSave = useRef(false);

  // Extract unique controls directly from analysis items
  const uniqueControls = useMemo((): UniqueControl[] => {
    const controlMap = new Map<string, AnalysisItem[]>();
    
    analysisItems.forEach(item => {
      if (item.controls) {
        item.controls.forEach(controlName => {
          const existing = controlMap.get(controlName) || [];
          existing.push(item);
          controlMap.set(controlName, existing);
        });
      }
    });

    // Convert to array and sort by number of protected items
    return Array.from(controlMap.entries())
      .map(([name, protectedItems]) => ({ name, protectedItems }))
      .sort((a, b) => b.protectedItems.length - a.protectedItems.length);
  }, [analysisItems]);
  
  // Default to all controls selected
  const [selectedControls, setSelectedControls] = useState<string[]>(
    data.selectedControls && data.selectedControls.length > 0 
      ? data.selectedControls 
      : []
  );

  // Update default selection when controls load
  useEffect(() => {
    if (uniqueControls.length > 0 && (!data.selectedControls || data.selectedControls.length === 0)) {
      setSelectedControls(uniqueControls.map(c => c.name));
      hasPendingSave.current = true;
    }
  }, [uniqueControls.length, data.selectedControls]);

  // Effect 1: Always sync incoming data to local state
  useEffect(() => {
    if (data.selectedControls && data.selectedControls.length > 0) {
      setSelectedControls(data.selectedControls);
    }
  }, [data.selectedControls]);

  const toggleControl = (controlName: string) => {
    setSelectedControls((prev) =>
      prev.includes(controlName) ? prev.filter((name) => name !== controlName) : [...prev, controlName]
    );
  };

  // Effect 2: Auto-save with debounce (blocked during webhook processing)
  useEffect(() => {
    if (isProcessingWebhook) {
      hasPendingSave.current = true;
      return;
    }
    
    if (hasPendingSave.current || selectedControls.length > 0) {
      const timer = setTimeout(() => {
        onNext({ selectedControls });
        hasPendingSave.current = false;
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [selectedControls, onNext, isProcessingWebhook]);

  const handleViewDetails = (control: UniqueControl) => {
    setSelectedControl(control);
    setDialogOpen(true);
  };

  if (analysisItems.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Shield className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>No controls detected yet.</p>
        <p className="text-sm mt-1">Connect to Google Drive and analyze files to discover recommended controls.</p>
      </div>
    );
  }

  if (uniqueControls.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Shield className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>No controls found in the analysis.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between bg-muted/30 p-4 rounded-lg">
        <div className="flex items-center gap-3">
          <Shield className="h-5 w-5 text-primary" />
          <span className="font-medium">{uniqueControls.length} Controls Identified</span>
        </div>
        <div className="text-sm text-muted-foreground">
          {selectedControls.filter(name => uniqueControls.some(c => c.name === name)).length} selected
        </div>
      </div>

      {/* Compact list view */}
      <div className="border rounded-lg divide-y">
        {uniqueControls.map((control) => {
          const isSelected = selectedControls.includes(control.name);
          const assetCount = control.protectedItems.filter(i => i.category === "Asset").length;
          const systemCount = control.protectedItems.filter(i => i.category === "Water System").length;
          const processCount = control.protectedItems.filter(i => i.category === "Process").length;

          return (
            <div 
              key={control.name}
              className={`flex items-center gap-3 p-3 cursor-pointer transition-colors hover:bg-muted/50 ${
                isSelected ? "bg-primary/5" : ""
              }`}
              onClick={() => toggleControl(control.name)}
            >
              {/* Checkbox indicator */}
              <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                isSelected 
                  ? "bg-primary border-primary" 
                  : "border-muted-foreground/30"
              }`}>
                {isSelected && (
                  <svg className="w-3 h-3 text-primary-foreground" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </div>

              {/* Control name */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{control.name}</p>
              </div>

              {/* Protection counts */}
              <div className="flex items-center gap-1 flex-shrink-0">
                {assetCount > 0 && (
                  <Badge variant="secondary" className="text-xs px-1.5 py-0">
                    {assetCount}A
                  </Badge>
                )}
                {systemCount > 0 && (
                  <Badge variant="secondary" className="text-xs px-1.5 py-0">
                    {systemCount}S
                  </Badge>
                )}
                {processCount > 0 && (
                  <Badge variant="secondary" className="text-xs px-1.5 py-0">
                    {processCount}P
                  </Badge>
                )}
              </div>

              {/* View details button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleViewDetails(control);
                }}
                className="p-1.5 hover:bg-muted rounded transition-colors flex-shrink-0"
              >
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
          );
        })}
      </div>

      <div className="text-xs text-muted-foreground text-center pt-2">
        A = Assets, S = Water Systems, P = Processes
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>{selectedControl?.name}</DialogTitle>
            <DialogDescription>
              Protects {selectedControl?.protectedItems.length} item{selectedControl?.protectedItems.length !== 1 ? 's' : ''}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] pr-4">
            <div className="space-y-4">
              {selectedControl?.protectedItems.map((item, index) => (
                <div key={index} className="border rounded-lg p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold">{item.areaName || item.name}</h4>
                    <div className="flex gap-2">
                      <Badge variant="outline">{item.category}</Badge>
                      <Badge variant="secondary">{item.id}</Badge>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    {item.floor && (
                      <div>
                        <span className="text-muted-foreground">Floor:</span> {item.floor}
                      </div>
                    )}
                    {item.drawingCode && (
                      <div>
                        <span className="text-muted-foreground">Drawing Code:</span> {item.drawingCode}
                      </div>
                    )}
                    {item.width && item.length && (
                      <div>
                        <span className="text-muted-foreground">Dimensions:</span> {item.width}' × {item.length}'
                      </div>
                    )}
                    {item.sizeCategory && (
                      <div>
                        <span className="text-muted-foreground">Size:</span> {item.sizeCategory}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
};