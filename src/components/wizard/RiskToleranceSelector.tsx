import { cn } from "@/lib/utils";
import { CheckCircle2, AlertTriangle, Shield, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type RiskTolerance = "low" | "medium" | "high";

interface CoverageBreakdown {
  assets: number;
  systems: number;
  processes: number;
}

interface ImplementationPackage {
  level: RiskTolerance;
  name: string;
  description: string;
  riskLabel: string;
  cost: number;
  coverage: CoverageBreakdown;
  protectedAssets: string[];
  unprotectedAssets: string[];
  controlCount: number;
}

interface ControlCountsByLevel {
  low: number;
  medium: number;
  high: number;
}

interface RiskScoreSummaryData {
  totalRiskPoints: number;
  deriskPoints: number;
  remainingPoints: number;
}

interface RiskToleranceSelectorProps {
  value: RiskTolerance;
  onChange: (value: RiskTolerance) => void;
  lowCost: number;
  mediumCost: number;
  highCost?: number;
  className?: string;
  lowCoverage?: CoverageBreakdown;
  mediumCoverage?: CoverageBreakdown;
  highCoverage?: CoverageBreakdown;
  controlCounts?: ControlCountsByLevel;
  lowProtectedAssets?: string[];
  mediumProtectedAssets?: string[];
  highProtectedAssets?: string[];
  allAssets?: string[];
  riskScore?: RiskScoreSummaryData;
  hasCustomSelection?: boolean;
}

export const RiskToleranceSelector = ({ 
  value, 
  onChange, 
  lowCost, 
  mediumCost, 
  highCost = 0,
  className,
  lowCoverage = { assets: 0, systems: 0, processes: 0 },
  mediumCoverage = { assets: 0, systems: 0, processes: 0 },
  highCoverage = { assets: 0, systems: 0, processes: 0 },
  controlCounts = { low: 0, medium: 0, high: 0 },
  lowProtectedAssets = [],
  mediumProtectedAssets = [],
  highProtectedAssets = [],
  allAssets = [],
  riskScore,
  hasCustomSelection = false
}: RiskToleranceSelectorProps) => {
  const formatCost = (cost: number) => {
    if (cost >= 1000000) return `$${(cost / 1000000).toFixed(1)}M`;
    if (cost >= 1000) return `$${(cost / 1000).toFixed(0)}K`;
    return `$${cost}`;
  };

  const getUnprotectedAssets = (protectedAssets: string[]) => allAssets.filter(a => !protectedAssets.includes(a));

  const formatCoverage = (coverage: CoverageBreakdown) => {
    const parts: string[] = [];
    if (coverage.assets > 0) parts.push(`${coverage.assets} asset${coverage.assets !== 1 ? 's' : ''}`);
    if (coverage.systems > 0) parts.push(`${coverage.systems} system${coverage.systems !== 1 ? 's' : ''}`);
    if (coverage.processes > 0) parts.push(`${coverage.processes} process${coverage.processes !== 1 ? 'es' : ''}`);
    return parts.length > 0 ? parts.join(', ') : 'None';
  };

  const packages: ImplementationPackage[] = [
    { level: "high", name: "Essential", description: "Core Systems Only.", riskLabel: "High", cost: highCost, coverage: highCoverage, protectedAssets: highProtectedAssets, unprotectedAssets: getUnprotectedAssets(highProtectedAssets), controlCount: controlCounts.high },
    { level: "medium", name: "Enhanced", description: "Expanded Scope.", riskLabel: "Medium", cost: mediumCost, coverage: mediumCoverage, protectedAssets: mediumProtectedAssets, unprotectedAssets: getUnprotectedAssets(mediumProtectedAssets), controlCount: controlCounts.medium },
    { level: "low", name: "Fortified", description: "Turnkey Protection.", riskLabel: "Low", cost: lowCost, coverage: lowCoverage, protectedAssets: lowProtectedAssets, unprotectedAssets: getUnprotectedAssets(lowProtectedAssets), controlCount: controlCounts.low }
  ];

  const getRiskColor = (net: number, total: number) => {
    if (total === 0) return "bg-muted";
    const ratio = net / total;
    if (ratio <= 0.25) return "bg-green-500 text-white";
    if (ratio <= 0.5) return "bg-yellow-500 text-black";
    if (ratio <= 0.75) return "bg-orange-500 text-white";
    return "bg-red-500 text-white";
  };

  return (
    <div className={cn("w-full space-y-4", className)}>
      {riskScore && (
        <div className="flex items-center gap-4 p-3 bg-muted/30 rounded-lg border">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <span className="text-sm font-medium">Total Water Risk:</span>
            <Badge className="text-xs bg-destructive text-destructive-foreground">{riskScore.totalRiskPoints} pts</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-green-600" />
            <span className="text-sm text-muted-foreground">DeRisk:</span>
            <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800">-{riskScore.deriskPoints} pts</Badge>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Remaining:</span>
            <Badge className={cn("text-xs", getRiskColor(riskScore.remainingPoints, riskScore.totalRiskPoints))}>{riskScore.remainingPoints} pts</Badge>
          </div>
        </div>
      )}

      <div className="border rounded-lg overflow-hidden bg-card">
        {/* Header Row */}
        <div className="grid grid-cols-4 bg-muted/50 border-b">
          <div className="p-4 font-medium text-sm text-muted-foreground">Implementation Level</div>
          {packages.map((pkg) => (
            <div key={pkg.level} className={cn("p-4 font-semibold text-sm cursor-pointer transition-colors border-l", value === pkg.level && !hasCustomSelection ? "bg-primary/10 text-primary" : "hover:bg-muted/80")} onClick={() => onChange(pkg.level)}>
              <div className="flex items-center gap-2">
                {value === pkg.level && !hasCustomSelection && <CheckCircle2 className="h-4 w-4 text-primary" />}
                {pkg.name}
              </div>
            </div>
          ))}
        </div>

        {/* Risk Tolerance Row */}
        <div className="grid grid-cols-4 border-b">
          <div className="p-4 font-medium text-sm text-muted-foreground">Risk Tolerance</div>
          {packages.map((pkg) => (
            <div key={pkg.level} className={cn("p-4 text-sm border-l cursor-pointer transition-colors", value === pkg.level && !hasCustomSelection ? "bg-primary/5" : "hover:bg-muted/30")} onClick={() => onChange(pkg.level)}>
              <span className={cn("font-medium", pkg.riskLabel === "High" && "text-red-600 dark:text-red-400", pkg.riskLabel === "Medium" && "text-yellow-600 dark:text-yellow-400", pkg.riskLabel === "Low" && "text-green-600 dark:text-green-400")}>{pkg.riskLabel}</span>
            </div>
          ))}
        </div>

        {/* Coverage Row */}
        <div className="grid grid-cols-4 border-b">
          <div className="p-4 font-medium text-sm text-muted-foreground">Coverage</div>
          <TooltipProvider>
            {packages.map((pkg) => (
              <div key={pkg.level} className={cn("p-4 text-sm border-l cursor-pointer transition-colors", value === pkg.level && !hasCustomSelection ? "bg-primary/5" : "hover:bg-muted/30")} onClick={() => onChange(pkg.level)}>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-xs">{formatCoverage(pkg.coverage)}</span>
                  {(pkg.protectedAssets.length > 0 || pkg.unprotectedAssets.length > 0) && (
                    <Tooltip>
                      <TooltipTrigger asChild><Info className="h-4 w-4 text-muted-foreground hover:text-foreground cursor-help" /></TooltipTrigger>
                      <TooltipContent className="max-w-xs p-3" side="bottom">
                        <div className="space-y-2 text-xs">
                          <p className="font-semibold">Coverage Breakdown:</p>
                          <p>• {pkg.coverage.assets} asset{pkg.coverage.assets !== 1 ? 's' : ''}</p>
                          <p>• {pkg.coverage.systems} water system{pkg.coverage.systems !== 1 ? 's' : ''}</p>
                          <p>• {pkg.coverage.processes} process{pkg.coverage.processes !== 1 ? 'es' : ''}</p>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </div>
            ))}
          </TooltipProvider>
        </div>

        {/* Total Controls Row */}
        <div className="grid grid-cols-4 border-b">
          <div className="p-4 font-medium text-sm text-muted-foreground">Total Controls</div>
          {packages.map((pkg) => (
            <div key={pkg.level} className={cn("p-4 text-sm border-l cursor-pointer transition-colors", value === pkg.level && !hasCustomSelection ? "bg-primary/5" : "hover:bg-muted/30")} onClick={() => onChange(pkg.level)}>
              <span className="font-medium">{pkg.controlCount}</span>
            </div>
          ))}
        </div>

        {/* Cost Estimate Row */}
        <div className="grid grid-cols-4">
          <div className="p-4 font-medium text-sm text-muted-foreground">Cost Estimate</div>
          {packages.map((pkg) => (
            <div key={pkg.level} className={cn("p-4 text-sm border-l cursor-pointer transition-colors", value === pkg.level && !hasCustomSelection ? "bg-primary/5" : "hover:bg-muted/30")} onClick={() => onChange(pkg.level)}>
              <span className="font-semibold text-foreground">{formatCost(pkg.cost)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
