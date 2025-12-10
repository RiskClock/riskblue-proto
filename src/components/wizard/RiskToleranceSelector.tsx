import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Shield, AlertTriangle, DollarSign } from "lucide-react";

export type RiskTolerance = "low" | "medium" | "high";

interface RiskToleranceSelectorProps {
  value: RiskTolerance;
  onChange: (value: RiskTolerance) => void;
  lowCost: number;
  mediumCost: number;
  className?: string;
}

export const RiskToleranceSelector = ({ value, onChange, lowCost, mediumCost, className }: RiskToleranceSelectorProps) => {
  const formatCost = (cost: number) => {
    if (cost >= 1000000) {
      return `$${(cost / 1000000).toFixed(1)}M`;
    }
    if (cost >= 1000) {
      return `$${(cost / 1000).toFixed(0)}K`;
    }
    return `$${cost}`;
  };

  const getCostForTolerance = (tolerance: RiskTolerance) => {
    if (tolerance === "low") return lowCost;
    if (tolerance === "medium") return mediumCost;
    return 0;
  };

  const currentCost = getCostForTolerance(value);

  const options: { value: RiskTolerance; label: string; description: string; icon: React.ReactNode; cost: number }[] = [
    {
      value: "low",
      label: "Low",
      description: "Maximum protection - all controls selected",
      icon: <Shield className="h-4 w-4" />,
      cost: lowCost
    },
    {
      value: "medium", 
      label: "Medium",
      description: "Balanced protection - recommended controls",
      icon: <AlertTriangle className="h-4 w-4" />,
      cost: mediumCost
    },
    {
      value: "high",
      label: "High",
      description: "Minimal protection - no controls selected",
      icon: <AlertTriangle className="h-4 w-4" />,
      cost: 0
    }
  ];

  return (
    <div className={cn("p-4 bg-gradient-to-r from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 rounded-xl border-2 border-slate-200 dark:border-slate-700 shadow-sm", className)}>
      <div className="flex items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <span className="font-semibold text-sm">Risk Tolerance:</span>
          </div>
          <div className="flex items-center gap-1 bg-background rounded-lg p-1 shadow-inner">
            {options.map((option) => (
              <button
                key={option.value}
                onClick={() => onChange(option.value)}
                className={cn(
                  "px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2",
                  value === option.value
                    ? option.value === "low" 
                      ? "bg-green-500 text-white shadow-md"
                      : option.value === "medium"
                        ? "bg-yellow-500 text-black shadow-md"
                        : "bg-red-500 text-white shadow-md"
                    : "text-muted-foreground hover:bg-muted/50"
                )}
                title={option.description}
              >
                {option.icon}
                <span>{option.label}</span>
                <span className="text-xs opacity-80">({formatCost(option.cost)})</span>
              </button>
            ))}
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <DollarSign className="h-5 w-5 text-muted-foreground" />
          <span className="text-sm font-medium text-muted-foreground">Total Est. Cost:</span>
          <Badge className="text-base px-4 py-1.5 bg-primary text-primary-foreground font-bold shadow-md">
            {formatCost(currentCost)}
          </Badge>
        </div>
      </div>
    </div>
  );
};
