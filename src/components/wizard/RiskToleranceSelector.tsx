import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Shield, AlertTriangle, DollarSign } from "lucide-react";

export type RiskTolerance = "low" | "medium" | "high";

interface RiskToleranceSelectorProps {
  value: RiskTolerance;
  onChange: (value: RiskTolerance) => void;
  totalCost: number;
  className?: string;
}

export const RiskToleranceSelector = ({ value, onChange, totalCost, className }: RiskToleranceSelectorProps) => {
  const formatCost = (cost: number) => {
    if (cost >= 1000000) {
      return `$${(cost / 1000000).toFixed(1)}M`;
    }
    if (cost >= 1000) {
      return `$${(cost / 1000).toFixed(0)}K`;
    }
    return `$${cost}`;
  };

  const options: { value: RiskTolerance; label: string; description: string; icon: React.ReactNode }[] = [
    {
      value: "low",
      label: "Low Risk Tolerance",
      description: "Maximum protection - all controls selected",
      icon: <Shield className="h-4 w-4" />
    },
    {
      value: "medium", 
      label: "Medium Risk Tolerance",
      description: "Balanced protection - recommended controls",
      icon: <AlertTriangle className="h-4 w-4" />
    },
    {
      value: "high",
      label: "High Risk Tolerance",
      description: "Minimal protection - no controls selected",
      icon: <AlertTriangle className="h-4 w-4" />
    }
  ];

  return (
    <div className={cn("flex items-center gap-4 p-3 bg-muted/30 rounded-lg border", className)}>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground">Risk Tolerance:</span>
        <div className="flex items-center gap-1">
          {options.map((option) => (
            <button
              key={option.value}
              onClick={() => onChange(option.value)}
              className={cn(
                "px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5",
                value === option.value
                  ? option.value === "low" 
                    ? "bg-green-500 text-white"
                    : option.value === "medium"
                      ? "bg-yellow-500 text-black"
                      : "bg-red-500 text-white"
                  : "bg-muted hover:bg-muted/80 text-muted-foreground"
              )}
              title={option.description}
            >
              {option.icon}
              {option.value.charAt(0).toUpperCase() + option.value.slice(1)}
            </button>
          ))}
        </div>
      </div>
      
      <div className="flex items-center gap-2 ml-auto">
        <DollarSign className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Total Est. Cost:</span>
        <Badge className="text-sm px-3 py-1 bg-primary text-primary-foreground">
          {formatCost(totalCost)}
        </Badge>
      </div>
    </div>
  );
};
