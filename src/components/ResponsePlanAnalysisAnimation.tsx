import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Shield, CheckCircle2, Sparkles, AlertTriangle, Zap, Target } from "lucide-react";

interface AnalysisPhase {
  id: string;
  label: string;
  icon: React.ReactNode;
  duration: number;
}

const analysisPhases: AnalysisPhase[] = [
  { id: "upload", label: "Uploading response plan", icon: <Zap className="w-4 h-4" />, duration: 1200 },
  { id: "scan", label: "Scanning document structure", icon: <Shield className="w-4 h-4" />, duration: 1800 },
  { id: "extract", label: "Extracting mitigation strategies", icon: <Target className="w-4 h-4" />, duration: 2000 },
  { id: "risks", label: "Identifying risk areas", icon: <AlertTriangle className="w-4 h-4" />, duration: 1600 },
  { id: "validate", label: "Validating response protocols", icon: <CheckCircle2 className="w-4 h-4" />, duration: 1400 },
  { id: "finalize", label: "Finalizing analysis", icon: <Sparkles className="w-4 h-4" />, duration: 1000 },
];

interface ResponsePlanAnalysisAnimationProps {
  fileName: string;
  isComplete: boolean;
}

export const ResponsePlanAnalysisAnimation = ({
  fileName,
  isComplete,
}: ResponsePlanAnalysisAnimationProps) => {
  const [currentPhaseIndex, setCurrentPhaseIndex] = useState(0);
  const [phaseProgress, setPhaseProgress] = useState(0);
  const [overallProgress, setOverallProgress] = useState(0);

  // Phase progression with looping
  useEffect(() => {
    if (isComplete) {
      setCurrentPhaseIndex(analysisPhases.length - 1);
      setPhaseProgress(100);
      setOverallProgress(100);
      return;
    }

    const currentPhase = analysisPhases[currentPhaseIndex];
    const interval = setInterval(() => {
      setPhaseProgress(prev => {
        const increment = 100 / (currentPhase.duration / 100);
        const newProgress = prev + increment;
        
        if (newProgress >= 100) {
          // Move to next phase or loop back
          if (currentPhaseIndex < analysisPhases.length - 1) {
            setCurrentPhaseIndex(currentPhaseIndex + 1);
          } else {
            setCurrentPhaseIndex(0);
          }
          return 0;
        }
        return newProgress;
      });
    }, 100);

    return () => clearInterval(interval);
  }, [currentPhaseIndex, isComplete]);

  // Calculate overall progress
  useEffect(() => {
    if (isComplete) {
      setOverallProgress(100);
      return;
    }

    const phaseWeight = 100 / analysisPhases.length;
    const completedPhasesProgress = currentPhaseIndex * phaseWeight;
    const currentPhaseProgress = (phaseProgress / 100) * phaseWeight;
    const total = completedPhasesProgress + currentPhaseProgress;
    
    setOverallProgress(Math.min(total, 95)); // Cap at 95% until complete
  }, [currentPhaseIndex, phaseProgress, isComplete]);

  const currentPhase = analysisPhases[currentPhaseIndex];

  return (
    <Card className="p-6 space-y-4 border-secondary/20 bg-gradient-to-br from-secondary/5 via-background to-primary/5 animate-fade-in">
      {/* Current Phase */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-secondary/10 text-secondary animate-pulse">
          {currentPhase.icon}
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium">{currentPhase.label}...</p>
          <p className="text-xs text-muted-foreground truncate">
            {fileName}
          </p>
        </div>
      </div>

      {/* Overall Progress */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Analysis Progress</span>
          <span>{Math.round(overallProgress)}%</span>
        </div>
        <Progress value={overallProgress} className="h-2" />
      </div>

      {/* Phase Timeline */}
      <div className="grid grid-cols-3 gap-2 pt-2">
        {analysisPhases.slice(0, 6).map((phase, index) => {
          const isActive = index === currentPhaseIndex;
          const isCompleted = index < currentPhaseIndex || isComplete;
          
          return (
            <div
              key={phase.id}
              className={`flex items-center gap-2 p-2 rounded-lg border transition-all ${
                isActive
                  ? "border-secondary bg-secondary/10 shadow-sm"
                  : isCompleted
                  ? "border-primary/20 bg-primary/5"
                  : "border-muted bg-muted/30"
              }`}
            >
              <div className={`transition-colors ${isActive ? "text-secondary" : isCompleted ? "text-primary" : "text-muted-foreground"}`}>
                {phase.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-xs font-medium truncate ${isActive ? "text-secondary" : isCompleted ? "text-primary" : "text-muted-foreground"}`}>
                  {phase.label.split(" ")[0]}
                </p>
              </div>
              {isCompleted && !isActive && (
                <CheckCircle2 className="w-3 h-3 text-primary flex-shrink-0" />
              )}
            </div>
          );
        })}
      </div>

      {/* Status Messages */}
      <div className="space-y-2 pt-2">
        <Card className="p-3 bg-muted/30 border-muted">
          <div className="flex items-start gap-2">
            <Shield className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium">Processing Response Plan</p>
              <p className="text-xs text-muted-foreground">
                Analyzing mitigation strategies and response protocols
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Completion Message */}
      {isComplete && (
        <div className="flex items-center gap-2 text-sm text-primary font-medium animate-fade-in pt-2">
          <Sparkles className="w-4 h-4" />
          <span>Response plan analyzed successfully!</span>
        </div>
      )}
    </Card>
  );
};
