import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ProjectRiskScore } from "@/hooks/useRiskScoring";
import { Shield, AlertTriangle, TrendingDown } from "lucide-react";

interface RiskScoreSummaryProps {
  riskScore: ProjectRiskScore;
  compact?: boolean;
}

export const RiskScoreSummary = ({ riskScore, compact = false }: RiskScoreSummaryProps) => {
  const { totalRiskPoints, selectedDeriskPoints, netRiskPoints, categoryScores } = riskScore;
  
  // Calculate risk reduction percentage
  const reductionPercentage = totalRiskPoints > 0 
    ? Math.round((selectedDeriskPoints / totalRiskPoints) * 100)
    : 0;
  
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
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-orange-500" />
          <span className="text-sm font-medium">Water Risk:</span>
          <Badge className={cn("text-xs", getRiskColor(netRiskPoints, totalRiskPoints))}>
            {netRiskPoints} pts
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-green-500" />
          <span className="text-sm text-muted-foreground">DeRisk:</span>
          <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200">
            -{selectedDeriskPoints} pts
          </Badge>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <TrendingDown className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium text-primary">{reductionPercentage}% reduced</span>
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
          <Badge variant="outline" className="text-sm px-3 py-1 bg-green-50 text-green-700 border-green-200">
            {reductionPercentage}% Mitigated
          </Badge>
        </div>
      </div>

      {/* Score Breakdown */}
      <div className="grid grid-cols-3 gap-4">
        <div className="p-3 bg-red-50 rounded-lg border border-red-100">
          <div className="text-xs text-red-600 font-medium uppercase tracking-wide">Total Risk</div>
          <div className="text-2xl font-bold text-red-700">{totalRiskPoints}</div>
          <div className="text-xs text-red-500">points</div>
        </div>
        <div className="p-3 bg-green-50 rounded-lg border border-green-100">
          <div className="text-xs text-green-600 font-medium uppercase tracking-wide">DeRisk Applied</div>
          <div className="text-2xl font-bold text-green-700">-{selectedDeriskPoints}</div>
          <div className="text-xs text-green-500">points</div>
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
