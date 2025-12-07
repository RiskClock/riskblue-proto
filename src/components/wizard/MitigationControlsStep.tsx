import { useState, useEffect, useRef, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Shield, Building2, Droplets, Users } from "lucide-react";
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

      {/* Accordion list view */}
      <Accordion type="multiple" className="border rounded-lg">
        {uniqueControls.map((control) => {
          const isSelected = selectedControls.includes(control.name);
          const assets = control.protectedItems.filter(i => i.category === "Asset");
          const systems = control.protectedItems.filter(i => i.category === "Water System");
          const processes = control.protectedItems.filter(i => i.category === "Process");

          return (
            <AccordionItem key={control.name} value={control.name} className="border-b last:border-b-0">
              <div className={`flex items-center transition-colors ${isSelected ? "bg-primary/5" : ""}`}>
                {/* Checkbox - stops propagation to not trigger accordion */}
                <div 
                  className="p-3 cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleControl(control.name);
                  }}
                >
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
                </div>

                {/* Accordion trigger covers the rest of the row */}
                <AccordionTrigger className="flex-1 hover:no-underline py-3 pr-3 [&>svg]:ml-2">
                  <div className="flex flex-1 items-center min-w-0">
                    <span className="text-sm font-medium text-left truncate">{control.name}</span>
                    <div className="flex items-center gap-1.5 ml-auto shrink-0">
                      {assets.length > 0 && (
                        <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100 border-0 text-xs font-medium px-2 py-0.5 shrink-0">
                          {assets.length} Asset{assets.length > 1 ? 's' : ''}
                        </Badge>
                      )}
                      {systems.length > 0 && (
                        <Badge className="bg-cyan-100 text-cyan-700 hover:bg-cyan-100 border-0 text-xs font-medium px-2 py-0.5 shrink-0">
                          {systems.length} System{systems.length > 1 ? 's' : ''}
                        </Badge>
                      )}
                      {processes.length > 0 && (
                        <Badge className="bg-violet-100 text-violet-700 hover:bg-violet-100 border-0 text-xs font-medium px-2 py-0.5 shrink-0">
                          {processes.length} Process{processes.length > 1 ? 'es' : ''}
                        </Badge>
                      )}
                    </div>
                  </div>
                </AccordionTrigger>
              </div>

              <AccordionContent className="px-3 pb-3">
                <div className="space-y-3 pt-2">
                  {/* Assets section */}
                  {assets.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                        <Building2 className="h-4 w-4" />
                        <span>Assets ({assets.length})</span>
                      </div>
                      <div className="grid gap-2 pl-6">
                        {assets.map((item, idx) => {
                          const capitalize = (str: string) => str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
                          const sizeDisplay = item.sizeCategory ? capitalize(item.sizeCategory) : null;
                          const dimensionDisplay = item.length && item.width ? `(${item.length} ft × ${item.width} ft)` : null;
                          return (
                            <div key={idx} className="flex items-center justify-between p-2 bg-muted/30 rounded border border-border/50 text-sm">
                              <span><span className="text-muted-foreground">{item.id}</span> — {item.areaName || item.name}</span>
                              <div className="flex gap-1">
                                {item.floor && <Badge variant="outline" className="text-xs">{item.floor}</Badge>}
                                {sizeDisplay && <Badge variant="secondary" className="text-xs">{sizeDisplay} {dimensionDisplay}</Badge>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Water Systems section */}
                  {systems.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                        <Droplets className="h-4 w-4" />
                        <span>Water Systems ({systems.length})</span>
                      </div>
                      <div className="grid gap-2 pl-6">
                        {systems.map((item, idx) => {
                          const capitalize = (str: string) => str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
                          const sizeDisplay = item.sizeCategory ? capitalize(item.sizeCategory) : null;
                          const dimensionDisplay = item.length && item.width ? `(${item.length} ft × ${item.width} ft)` : null;
                          return (
                            <div key={idx} className="flex items-center justify-between p-2 bg-muted/30 rounded border border-border/50 text-sm">
                              <span><span className="text-muted-foreground">{item.id}</span> — {item.areaName || item.name}</span>
                              <div className="flex gap-1">
                                {item.floor && <Badge variant="outline" className="text-xs">{item.floor}</Badge>}
                                {sizeDisplay && <Badge variant="secondary" className="text-xs">{sizeDisplay} {dimensionDisplay}</Badge>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Processes section */}
                  {processes.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                        <Users className="h-4 w-4" />
                        <span>Processes ({processes.length})</span>
                      </div>
                      <div className="grid gap-2 pl-6">
                        {processes.map((item, idx) => (
                          <div key={idx} className="flex items-center justify-between p-2 bg-muted/30 rounded border border-border/50 text-sm">
                            <span><span className="text-muted-foreground">{item.id}</span> — {item.areaName || item.name}</span>
                            <div className="flex gap-1">
                              {item.floor && <Badge variant="outline" className="text-xs">{item.floor}</Badge>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
    </div>
  );
};
