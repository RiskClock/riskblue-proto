import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ProjectRiskScore, getRiskLabel, getRiskLabelStyles } from "@/hooks/useRiskScoring";
import { Shield, AlertTriangle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";

interface RiskScoreSummaryProps {
  riskScore: ProjectRiskScore;
  compact?: boolean;
}

// Inline version for class headers - just the badges with visual separator
interface ClassRiskBadgesProps {
  riskPoints?: number;
  deriskPoints?: number;
  cost?: number;
  locationCount?: number;
  showRiskLabel?: boolean;
  missingMilestones?: string[];
}

// Format cost helper
const formatCost = (cost: number) => {
  if (cost >= 1000000) return `$${(cost / 1000000).toFixed(1)}M`;
  if (cost >= 1000) return `$${(cost / 1000).toFixed(1)}K`;
  return `$${cost}`;
};

export const ClassRiskBadges = ({ 
  riskPoints, 
  deriskPoints, 
  cost,
  locationCount,
  showRiskLabel = true,
  missingMilestones = []
}: ClassRiskBadgesProps) => {
  // Round deriskPoints to 1 decimal for display
  const displayDerisk = deriskPoints !== undefined ? Math.round(deriskPoints * 10) / 10 : undefined;
  
  // Show tooltip for $0 cost when there are missing milestones
  const showCostTooltip = cost === 0 && missingMilestones.length > 0;
  
  return (
    <div className="flex items-center gap-1.5">
      {/* Visual separator before totals */}
      <div className="h-6 w-px bg-border mx-1" />
      
      {riskPoints !== undefined && riskPoints > 0 && (
        <Badge variant="outline" className="text-xs bg-red-50 text-red-600 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800">
          {showRiskLabel && <AlertTriangle className="h-3 w-3 mr-1" />}
          {riskPoints} risk
        </Badge>
      )}
      {displayDerisk !== undefined && displayDerisk > 0 && (
        <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800">
          {showRiskLabel && <Shield className="h-3 w-3 mr-1" />}
          -{displayDerisk} derisk
        </Badge>
      )}
      {cost !== undefined && (
        showCostTooltip ? (
          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span 
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="inline-flex"
                >
                  <Badge variant="outline" className="text-xs cursor-help bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800">
                    $0
                  </Badge>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>Missing dates for {missingMilestones.join(' and ')} milestone{missingMilestones.length > 1 ? 's' : ''}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : cost > 0 ? (
          <Badge variant="outline" className="text-xs cursor-default bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800">
            {formatCost(cost)}
          </Badge>
        ) : null
      )}
    </div>
  );
};

export const RiskScoreSummary = ({ riskScore, compact = false }: RiskScoreSummaryProps) => {
  const { totalRiskPoints, selectedDeriskPoints, netRiskPoints, categoryScores } = riskScore;
  
  // Determine risk level color based on net risk
  const getRiskColor = (net: number, total: number) => {
    const ratio = total > 0 ? net / total : 0;
    if (ratio <= 0.25) return "bg-green-500 text-white";
    if (ratio <= 0.5) return "bg-yellow-500 text-black";
    if (ratio <= 0.75) return "bg-orange-500 text-white";
    return "bg-red-500 text-white";
  };

  if (compact) {
    return (
      <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg border">
        {/* Total Risk */}
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          <span className="text-sm font-medium">Water Risk:</span>
          <Badge className="text-xs bg-destructive text-destructive-foreground">
            {totalRiskPoints} pts
          </Badge>
        </div>
        {/* DeRisk Applied */}
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-green-600" />
          <span className="text-sm text-muted-foreground">DeRisk:</span>
          <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800">
            -{selectedDeriskPoints} pts
          </Badge>
        </div>
        {/* Remaining Risk */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Remaining:</span>
          <Badge className={cn("text-xs", getRiskColor(netRiskPoints, totalRiskPoints))}>
            {netRiskPoints} pts
          </Badge>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 bg-muted/20 rounded-lg border">
      {/* Header Summary */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-orange-500" />
          Project Water Risk Score
        </h3>
        <div className="flex items-center gap-3">
          <Badge className={cn("text-sm px-3 py-1", getRiskColor(netRiskPoints, totalRiskPoints))}>
            Net Risk: {netRiskPoints} pts
          </Badge>
        </div>
      </div>

      {/* Score Breakdown */}
      <div className="grid grid-cols-3 gap-4">
        <div className="p-3 bg-red-50 rounded-lg border border-red-100 dark:bg-red-950 dark:border-red-800">
          <div className="text-xs text-red-600 dark:text-red-300 font-medium uppercase tracking-wide">Total Risk</div>
          <div className="text-2xl font-bold text-red-700 dark:text-red-200">{totalRiskPoints}</div>
          <div className="text-xs text-red-500 dark:text-red-400">points</div>
        </div>
        <div className="p-3 bg-green-50 rounded-lg border border-green-100 dark:bg-green-950 dark:border-green-800">
          <div className="text-xs text-green-600 dark:text-green-300 font-medium uppercase tracking-wide">DeRisk Applied</div>
          <div className="text-2xl font-bold text-green-700 dark:text-green-200">-{selectedDeriskPoints}</div>
          <div className="text-xs text-green-500 dark:text-green-400">points</div>
        </div>
        <div className={cn("p-3 rounded-lg border", 
          getRiskColor(netRiskPoints, totalRiskPoints).replace("bg-", "bg-opacity-10 bg-").replace("text-white", "").replace("text-black", "")
        )}>
          <div className="text-xs font-medium uppercase tracking-wide">Net Risk</div>
          <div className="text-2xl font-bold">{netRiskPoints}</div>
          <div className="text-xs">points remaining</div>
        </div>
      </div>

      {/* Category Breakdown */}
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-muted-foreground">By Category</h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {categoryScores.map(cat => (
            <div key={cat.category} className="p-2 bg-background rounded border text-sm">
              <div className="font-medium truncate">{cat.category}</div>
              <div className="flex items-center justify-between text-xs text-muted-foreground mt-1">
                <span className="text-red-500">Risk: {cat.riskPoints}</span>
                <span className="text-green-500">DeRisk: -{cat.selectedDeriskPoints}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
