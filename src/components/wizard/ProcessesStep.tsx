import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Info, Users, Check } from "lucide-react";
import { AnalysisItem } from "@/lib/analysisItemMapper";

interface ProcessesStepProps {
  data?: any;
  onNext?: (data: any) => void;
  isProcessingWebhook?: boolean;
  analysisItems?: AnalysisItem[];
}

export const ProcessesStep = ({ 
  data = {}, 
  onNext, 
  isProcessingWebhook,
  analysisItems = [] 
}: ProcessesStepProps) => {
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [selectedProcess, setSelectedProcess] = useState<AnalysisItem | null>(null);
  const hasPendingSave = useRef(false);

  // Filter only process items
  const processItems = analysisItems.filter(item => item.category === "Process");

  // Selection state - default to all selected
  const [selectedProcesses, setSelectedProcesses] = useState<string[]>(
    data.selectedProcesses && data.selectedProcesses.length > 0 
      ? data.selectedProcesses 
      : []
  );

  // Initialize selection when process items load
  useEffect(() => {
    if (processItems.length > 0 && (!data.selectedProcesses || data.selectedProcesses.length === 0)) {
      setSelectedProcesses(processItems.map(p => p.id));
      hasPendingSave.current = true;
    }
  }, [processItems.length, data.selectedProcesses]);

  // Sync incoming data to local state
  useEffect(() => {
    if (data.selectedProcesses && data.selectedProcesses.length > 0) {
      setSelectedProcesses(data.selectedProcesses);
    }
  }, [data.selectedProcesses]);

  // Auto-save with debounce
  useEffect(() => {
    if (!onNext) return;
    
    if (isProcessingWebhook) {
      hasPendingSave.current = true;
      return;
    }
    
    if (hasPendingSave.current || selectedProcesses.length > 0) {
      const timer = setTimeout(() => {
        onNext({ selectedProcesses });
        hasPendingSave.current = false;
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [selectedProcesses, onNext, isProcessingWebhook]);

  const toggleProcess = (processId: string) => {
    setSelectedProcesses((prev) =>
      prev.includes(processId) ? prev.filter((id) => id !== processId) : [...prev, processId]
    );
  };

  const handleOpenDetail = (e: React.MouseEvent, process: AnalysisItem) => {
    e.stopPropagation();
    setSelectedProcess(process);
    setDetailDialogOpen(true);
  };

  if (processItems.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>No processes detected from AI analysis.</p>
        <p className="text-sm mt-1">Upload project files to identify stakeholder responsibilities.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {processItems.map((process) => {
          const isSelected = selectedProcesses.includes(process.id);
          
          return (
            <div
              key={process.id}
              onClick={() => toggleProcess(process.id)}
              className={`p-4 rounded-lg cursor-pointer transition-all relative border ${
                isSelected 
                  ? "border-primary bg-primary/5" 
                  : "border-border hover:border-primary/50"
              }`}
            >
              {/* Selection indicator */}
              {isSelected && (
                <div className="absolute top-2 left-2 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                  <Check className="h-3 w-3 text-primary-foreground" />
                </div>
              )}

              <button 
                onClick={(e) => handleOpenDetail(e, process)}
                className="absolute top-2 right-2 p-1 hover:bg-muted rounded-full transition-colors"
              >
                <Info className="h-4 w-4 text-muted-foreground" />
              </button>

              <div className="mb-3 pt-4">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-sm">{process.name}</h3>
                </div>
                <span className="inline-block px-2 py-0.5 text-xs bg-secondary text-secondary-foreground rounded">
                  Process
                </span>
              </div>
              
              <div className="w-full h-32 rounded-md mb-3 bg-muted/30 flex items-center justify-center">
                <Users className="h-12 w-12 text-muted-foreground/50" />
              </div>
              
              <p className="text-xs text-muted-foreground mb-3">
                <strong>Controls:</strong> {process.controls?.length || 0} assigned
              </p>
              
              {process.controls && process.controls.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {process.controls.slice(0, 2).map((control, i) => (
                    <Badge key={i} variant="secondary" className="text-xs truncate max-w-full">
                      {control.length > 20 ? control.substring(0, 20) + '...' : control}
                    </Badge>
                  ))}
                  {process.controls.length > 2 && (
                    <Badge variant="outline" className="text-xs">
                      +{process.controls.length - 2}
                    </Badge>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Detail Dialog */}
      <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>{selectedProcess?.name}</DialogTitle>
            <DialogDescription>
              {selectedProcess?.controls?.length || 0} control{selectedProcess?.controls?.length !== 1 ? 's' : ''} assigned
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] pr-4">
            {selectedProcess && (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{selectedProcess.id}</Badge>
                  <Badge variant="secondary">Process</Badge>
                </div>

                {selectedProcess.controls && selectedProcess.controls.length > 0 && (
                  <div className="space-y-3">
                    <h4 className="font-semibold">Assigned Controls</h4>
                    <div className="space-y-2">
                      {selectedProcess.controls.map((control, i) => (
                        <div 
                          key={i} 
                          className="p-3 rounded-lg border bg-muted/30 flex items-center gap-3"
                        >
                          <div className="h-2 w-2 rounded-full bg-primary flex-shrink-0" />
                          <span className="text-sm">{control}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
};
