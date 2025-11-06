import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, Calendar, CheckCircle2, Sparkles, Search, Brain } from "lucide-react";

interface AnalysisStage {
  id: string;
  label: string;
  icon: React.ReactNode;
  duration: number;
}

const analysisStages: AnalysisStage[] = [
  { id: "reading", label: "Reading document structure", icon: <FileText className="w-4 h-4" />, duration: 1500 },
  { id: "extracting", label: "Extracting content", icon: <Search className="w-4 h-4" />, duration: 2000 },
  { id: "milestones", label: "Identifying project milestones", icon: <CheckCircle2 className="w-4 h-4" />, duration: 1800 },
  { id: "dates", label: "Detecting critical dates", icon: <Calendar className="w-4 h-4" />, duration: 1500 },
  { id: "analyzing", label: "Analyzing construction phases", icon: <Brain className="w-4 h-4" />, duration: 1600 },
  { id: "finalizing", label: "Finalizing extraction", icon: <Sparkles className="w-4 h-4" />, duration: 1000 },
];

interface PDFAnalysisAnimationProps {
  pageCount: number;
  currentPage: number;
  extractedText: string[];
  extractedDates: string[];
  extractedMilestones: string[];
  isComplete: boolean;
}

export const PDFAnalysisAnimation = ({
  pageCount,
  currentPage,
  extractedText,
  extractedDates,
  extractedMilestones,
  isComplete,
}: PDFAnalysisAnimationProps) => {
  const [currentStageIndex, setCurrentStageIndex] = useState(0);
  const [stageProgress, setStageProgress] = useState(0);

  useEffect(() => {
    if (isComplete) {
      setCurrentStageIndex(analysisStages.length - 1);
      setStageProgress(100);
      return;
    }

    const currentStage = analysisStages[currentStageIndex];
    const interval = setInterval(() => {
      setStageProgress(prev => {
        const newProgress = prev + (100 / (currentStage.duration / 100));
        if (newProgress >= 100) {
          // Loop back to beginning if we reach the end but not complete
          if (currentStageIndex < analysisStages.length - 1) {
            setCurrentStageIndex(currentStageIndex + 1);
            return 0;
          } else {
            // Loop back to start
            setCurrentStageIndex(0);
            return 0;
          }
        }
        return newProgress;
      });
    }, 100);

    return () => clearInterval(interval);
  }, [currentStageIndex, isComplete]);

  const currentStage = analysisStages[currentStageIndex];
  const overallProgress = ((currentPage / pageCount) * 100).toFixed(0);

  return (
    <Card className="p-6 space-y-4 border-primary/20 bg-gradient-to-br from-primary/5 to-background animate-fade-in">
      {/* Current Stage */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary/10 text-primary animate-pulse">
          {currentStage.icon}
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium">{currentStage.label}...</p>
          <p className="text-xs text-muted-foreground">
            Processing page {currentPage} of {pageCount}
          </p>
        </div>
      </div>

      {/* Progress Bar */}
      <Progress value={parseInt(overallProgress)} className="h-2" />

      {/* Extracted Information Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Document Info */}
        <Card className="p-4 space-y-2 bg-muted/30">
          <div className="flex items-center gap-2 text-sm font-medium">
            <FileText className="w-4 h-4 text-primary" />
            <span>Document Analysis</span>
          </div>
          {pageCount > 0 ? (
            <div className="space-y-1 text-xs text-muted-foreground">
              <p>Total Pages: {pageCount}</p>
              <p>Pages Processed: {currentPage}</p>
              <p className="text-primary font-medium">{overallProgress}% Complete</p>
            </div>
          ) : (
            <Skeleton className="h-12 w-full" />
          )}
        </Card>

        {/* Extracted Dates */}
        <Card className="p-4 space-y-2 bg-muted/30">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Calendar className="w-4 h-4 text-primary" />
            <span>Detected Dates</span>
          </div>
          {extractedDates.length > 0 ? (
            <div className="space-y-1">
              {extractedDates.slice(0, 3).map((date, i) => (
                <p key={i} className="text-xs text-muted-foreground animate-fade-in">
                  • {date}
                </p>
              ))}
            </div>
          ) : (
            <Skeleton className="h-12 w-full" />
          )}
        </Card>

        {/* Extracted Text Snippets */}
        {extractedText.length > 0 && (
          <Card className="p-4 space-y-2 bg-muted/30 md:col-span-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Search className="w-4 h-4 text-primary" />
              <span>Content Preview</span>
            </div>
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {extractedText.slice(0, 3).map((text, i) => (
                <p key={i} className="text-xs text-muted-foreground line-clamp-2 animate-fade-in">
                  {text.substring(0, 150)}...
                </p>
              ))}
            </div>
          </Card>
        )}

        {/* Extracted Milestones */}
        {extractedMilestones.length > 0 && (
          <Card className="p-4 space-y-2 bg-muted/30 md:col-span-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <CheckCircle2 className="w-4 h-4 text-primary" />
              <span>Potential Milestones</span>
            </div>
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {extractedMilestones.slice(0, 4).map((milestone, i) => (
                <p key={i} className="text-xs text-muted-foreground animate-fade-in">
                  • {milestone}
                </p>
              ))}
            </div>
          </Card>
        )}
      </div>

      {/* Completion Message */}
      {isComplete && (
        <div className="flex items-center gap-2 text-sm text-primary font-medium animate-fade-in">
          <Sparkles className="w-4 h-4" />
          <span>Analysis complete! Processing final results...</span>
        </div>
      )}
    </Card>
  );
};
