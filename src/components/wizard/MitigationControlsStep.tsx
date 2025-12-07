import { useState, useEffect, useRef, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Info, Shield, ChevronDown, ChevronUp } from "lucide-react";
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
  const [expandedControls, setExpandedControls] = useState<Set<string>>(new Set());

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

  const toggleExpanded = (controlName: string) => {
    setExpandedControls(prev => {
      const newSet = new Set(prev);
      if (newSet.has(controlName)) {
        newSet.delete(controlName);
      } else {
        newSet.add(controlName);
      }
      return newSet;
    });
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

  const handleMoreInfo = (control: UniqueControl) => {
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
    <div className="space-y-6">
      <div className="bg-muted/30 p-6 rounded-lg mb-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className="text-2xl">⚙️</div>
            <div>
              <p className="font-semibold">Controls</p>
              <p className="text-sm text-muted-foreground">
                {selectedControls.filter(name => uniqueControls.some(c => c.name === name)).length} / {uniqueControls.length} Selected
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-2xl">🛡️</div>
            <div>
              <p className="font-semibold">Unique Controls</p>
              <p className="text-sm text-muted-foreground">
                {uniqueControls.length} controls from AI analysis
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Controls grid - matching asset/system card style */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {uniqueControls.map((control) => {
          const isSelected = selectedControls.includes(control.name);
          const isExpanded = expandedControls.has(control.name);
          const assetCount = control.protectedItems.filter(i => i.category === "Asset").length;
          const systemCount = control.protectedItems.filter(i => i.category === "Water System").length;
          const processCount = control.protectedItems.filter(i => i.category === "Process").length;

          return (
            <div 
              key={control.name}
              className={`p-4 rounded-lg cursor-pointer transition-all relative ${
                isSelected 
                  ? "border-2 border-primary bg-primary/5" 
                  : "border border-border hover:border-primary/50"
              }`}
              onClick={() => toggleControl(control.name)}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleMoreInfo(control);
                }}
                className="absolute top-2 right-2 p-1 hover:bg-muted rounded-full transition-colors"
              >
                <Info className="h-4 w-4 text-muted-foreground" />
              </button>

              <div className="mb-3 pr-8">
                <div className="flex items-start gap-2 mb-2">
                  <Shield className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                  <h3 className="font-semibold text-sm leading-tight">{control.name}</h3>
                </div>
              </div>
              
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>Protects:</span>
                  <div className="flex flex-wrap gap-1">
                    {assetCount > 0 && (
                      <Badge variant="secondary" className="text-xs">
                        {assetCount} asset{assetCount !== 1 ? 's' : ''}
                      </Badge>
                    )}
                    {systemCount > 0 && (
                      <Badge variant="secondary" className="text-xs">
                        {systemCount} system{systemCount !== 1 ? 's' : ''}
                      </Badge>
                    )}
                    {processCount > 0 && (
                      <Badge variant="secondary" className="text-xs">
                        {processCount} process{processCount !== 1 ? 'es' : ''}
                      </Badge>
                    )}
                  </div>
                </div>

                {control.protectedItems.length > 0 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleExpanded(control.name);
                    }}
                    className="flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    {isExpanded ? (
                      <>
                        <ChevronUp className="h-3 w-3" />
                        Hide details
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-3 w-3" />
                        Show details
                      </>
                    )}
                  </button>
                )}
              </div>

              {/* Expanded Protected Items */}
              {isExpanded && (
                <div className="mt-3 pt-3 border-t space-y-2">
                  {control.protectedItems.slice(0, 5).map((item, i) => (
                    <div key={i} className="text-xs bg-muted/50 rounded px-2 py-1">
                      <span className="font-medium">{item.areaName || item.name}</span>
                      {item.floor && <span className="text-muted-foreground"> ({item.floor})</span>}
                    </div>
                  ))}
                  {control.protectedItems.length > 5 && (
                    <p className="text-xs text-muted-foreground">
                      +{control.protectedItems.length - 5} more...
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
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