import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Info, Users, Wrench, Building2 } from "lucide-react";
import { AnalysisItem } from "@/lib/analysisItemMapper";

interface ProcessesStepProps {
  analysisItems?: AnalysisItem[];
}

export const ProcessesStep = ({ analysisItems = [] }: ProcessesStepProps) => {
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [selectedProcess, setSelectedProcess] = useState<AnalysisItem | null>(null);

  // Filter only process items
  const processItems = analysisItems.filter(item => item.category === "Process");

  const getProcessIcon = (name: string) => {
    const lower = name.toLowerCase();
    if (lower.includes('contractor')) return <Users className="h-8 w-8" />;
    if (lower.includes('vendor')) return <Wrench className="h-8 w-8" />;
    if (lower.includes('mechanical') || lower.includes('engineering')) return <Building2 className="h-8 w-8" />;
    return <Users className="h-8 w-8" />;
  };

  const getProcessColor = (name: string) => {
    const lower = name.toLowerCase();
    if (lower.includes('contractor')) return 'bg-blue-500/10 text-blue-700 border-blue-500/30';
    if (lower.includes('vendor')) return 'bg-green-500/10 text-green-700 border-green-500/30';
    if (lower.includes('mechanical') || lower.includes('engineering')) return 'bg-purple-500/10 text-purple-700 border-purple-500/30';
    return 'bg-muted text-muted-foreground border-border';
  };

  const handleOpenDetail = (process: AnalysisItem) => {
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
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {processItems.map((process) => (
          <div
            key={process.id}
            onClick={() => handleOpenDetail(process)}
            className={`p-6 rounded-lg cursor-pointer transition-all border-2 hover:shadow-md ${getProcessColor(process.name)}`}
          >
            <div className="flex items-start justify-between mb-4">
              <div className={`p-3 rounded-lg ${getProcessColor(process.name)}`}>
                {getProcessIcon(process.name)}
              </div>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  handleOpenDetail(process);
                }}
                className="p-1 hover:bg-background/50 rounded-full transition-colors"
              >
                <Info className="h-4 w-4" />
              </button>
            </div>
            
            <h3 className="font-semibold text-lg mb-2">{process.name}</h3>
            
            <div className="flex items-center gap-2 text-sm">
              <Badge variant="secondary">
                {process.controls?.length || 0} Controls
              </Badge>
            </div>

            {process.controls && process.controls.length > 0 && (
              <div className="mt-4 pt-4 border-t border-current/10">
                <p className="text-xs opacity-70 mb-2">Key Controls:</p>
                <div className="flex flex-wrap gap-1">
                  {process.controls.slice(0, 3).map((control, i) => (
                    <Badge key={i} variant="outline" className="text-xs">
                      {control.length > 25 ? control.substring(0, 25) + '...' : control}
                    </Badge>
                  ))}
                  {process.controls.length > 3 && (
                    <Badge variant="outline" className="text-xs">
                      +{process.controls.length - 3} more
                    </Badge>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Detail Dialog */}
      <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              {selectedProcess && getProcessIcon(selectedProcess.name)}
              {selectedProcess?.name}
            </DialogTitle>
            <DialogDescription>
              Stakeholder responsibilities and controls
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] pr-4">
            {selectedProcess && (
              <div className="space-y-6">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{selectedProcess.id}</Badge>
                  <Badge variant="secondary">Process</Badge>
                </div>

                {selectedProcess.controls && selectedProcess.controls.length > 0 && (
                  <div className="space-y-3">
                    <h4 className="font-semibold">Assigned Controls</h4>
                    <p className="text-sm text-muted-foreground">
                      These controls are the responsibility of this stakeholder:
                    </p>
                    <div className="space-y-2">
                      {selectedProcess.controls.map((control, i) => (
                        <div 
                          key={i} 
                          className="p-3 rounded-lg border bg-muted/30 flex items-center gap-3"
                        >
                          <div className="h-2 w-2 rounded-full bg-primary" />
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
