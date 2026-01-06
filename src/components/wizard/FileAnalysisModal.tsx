import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { FileText, Search, Brain, Sparkles, CheckCircle2, Loader2 } from "lucide-react";

interface AnalysisPhase {
  id: string;
  label: string;
  icon: React.ReactNode;
  durationMs: number;
}

const analysisPhases: AnalysisPhase[] = [
  { id: "connecting", label: "Connecting to repository", icon: <FileText className="w-4 h-4" />, durationMs: 3000 },
  { id: "scanning", label: "Scanning file structure", icon: <Search className="w-4 h-4" />, durationMs: 4000 },
  { id: "extracting", label: "Extracting document data", icon: <FileText className="w-4 h-4" />, durationMs: 5000 },
  { id: "analyzing", label: "Analyzing drawings", icon: <Brain className="w-4 h-4" />, durationMs: 8000 },
  { id: "identifying", label: "Identifying assets & systems", icon: <CheckCircle2 className="w-4 h-4" />, durationMs: 6000 },
  { id: "finalizing", label: "Finalizing results", icon: <Sparkles className="w-4 h-4" />, durationMs: 4000 },
];

// Total duration should be ~30 seconds (sum of all phases)
const TOTAL_DURATION_MS = analysisPhases.reduce((sum, phase) => sum + phase.durationMs, 0);

interface FileInfo {
  name: string;
  id: string;
}

interface FileAnalysisModalProps {
  isOpen: boolean;
  files: FileInfo[];
  onComplete: () => void;
}

export const FileAnalysisModal = ({
  isOpen,
  files,
  onComplete,
}: FileAnalysisModalProps) => {
  const [currentPhaseIndex, setCurrentPhaseIndex] = useState(0);
  const [phaseProgress, setPhaseProgress] = useState(0);
  const [overallProgress, setOverallProgress] = useState(0);
  const [processedFileIndex, setProcessedFileIndex] = useState(0);
  const [isComplete, setIsComplete] = useState(false);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setCurrentPhaseIndex(0);
      setPhaseProgress(0);
      setOverallProgress(0);
      setProcessedFileIndex(0);
      setIsComplete(false);
    }
  }, [isOpen]);

  // Main animation loop
  useEffect(() => {
    if (!isOpen || isComplete) return;

    const currentPhase = analysisPhases[currentPhaseIndex];
    const updateInterval = 100; // Update every 100ms
    const progressPerUpdate = (100 / (currentPhase.durationMs / updateInterval));

    const interval = setInterval(() => {
      setPhaseProgress(prev => {
        const newProgress = prev + progressPerUpdate;
        if (newProgress >= 100) {
          // Move to next phase
          if (currentPhaseIndex < analysisPhases.length - 1) {
            setCurrentPhaseIndex(currentPhaseIndex + 1);
            return 0;
          } else {
            // All phases complete
            setIsComplete(true);
            clearInterval(interval);
            // Dismiss after a brief delay
            setTimeout(() => {
              onComplete();
            }, 1000);
            return 100;
          }
        }
        return newProgress;
      });
    }, updateInterval);

    return () => clearInterval(interval);
  }, [isOpen, currentPhaseIndex, isComplete, onComplete]);

  // Update overall progress
  useEffect(() => {
    if (!isOpen) return;
    
    const completedPhasesTime = analysisPhases
      .slice(0, currentPhaseIndex)
      .reduce((sum, phase) => sum + phase.durationMs, 0);
    
    const currentPhaseTime = analysisPhases[currentPhaseIndex]?.durationMs || 0;
    const currentPhaseContribution = (phaseProgress / 100) * currentPhaseTime;
    
    const totalElapsed = completedPhasesTime + currentPhaseContribution;
    const overall = Math.min((totalElapsed / TOTAL_DURATION_MS) * 100, 100);
    
    setOverallProgress(overall);
  }, [isOpen, currentPhaseIndex, phaseProgress]);

  // Rotate through files being "processed"
  useEffect(() => {
    if (!isOpen || isComplete || files.length === 0) return;

    const rotateInterval = setInterval(() => {
      setProcessedFileIndex(prev => (prev + 1) % files.length);
    }, 1500);

    return () => clearInterval(rotateInterval);
  }, [isOpen, isComplete, files.length]);

  const currentPhase = analysisPhases[currentPhaseIndex];
  const currentFile = files[processedFileIndex];

  return (
    <Dialog open={isOpen} onOpenChange={() => {}}>
      <DialogContent 
        className="sm:max-w-lg"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
            Analyzing Drawing Files
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Current Phase Indicator */}
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
            <div className="p-2 rounded-lg bg-primary/10 text-primary animate-pulse">
              {currentPhase.icon}
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">{currentPhase.label}...</p>
              {currentFile && (
                <p className="text-xs text-muted-foreground truncate max-w-[300px]">
                  {currentFile.name}
                </p>
              )}
            </div>
          </div>

          {/* Phase Progress */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{currentPhase.label}</span>
              <span>{Math.round(phaseProgress)}%</span>
            </div>
            <Progress value={phaseProgress} className="h-2" />
          </div>

          {/* Overall Progress */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Overall Progress</span>
              <span>{Math.round(overallProgress)}%</span>
            </div>
            <Progress value={overallProgress} className="h-3" />
          </div>

          {/* Files Being Analyzed */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              Analyzing {files.length} file{files.length !== 1 ? 's' : ''}
            </p>
            <div className="max-h-24 overflow-y-auto space-y-1 p-2 bg-muted/30 rounded-md">
              {files.slice(0, 8).map((file, i) => (
                <div 
                  key={file.id} 
                  className={`text-xs flex items-center gap-2 transition-colors ${
                    processedFileIndex === i ? 'text-primary font-medium' : 'text-muted-foreground'
                  }`}
                >
                  <FileText className="w-3 h-3 shrink-0" />
                  <span className="truncate">{file.name}</span>
                </div>
              ))}
              {files.length > 8 && (
                <p className="text-xs text-muted-foreground">
                  + {files.length - 8} more files...
                </p>
              )}
            </div>
          </div>

          {/* Phase Timeline */}
          <div className="flex items-center gap-1 justify-center pt-2">
            {analysisPhases.map((phase, i) => (
              <div 
                key={phase.id}
                className={`h-1.5 w-8 rounded-full transition-colors ${
                  i < currentPhaseIndex
                    ? 'bg-primary'
                    : i === currentPhaseIndex
                    ? 'bg-primary/60'
                    : 'bg-muted'
                }`}
              />
            ))}
          </div>

          {/* Completion Message */}
          {isComplete && (
            <div className="flex items-center gap-2 text-sm text-primary font-medium animate-fade-in justify-center">
              <Sparkles className="w-4 h-4" />
              <span>Analysis complete!</span>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
