import { cn } from "@/lib/utils";
import { CheckCircle2 } from "lucide-react";

export type RiskTolerance = "low" | "medium" | "high";

interface ImplementationPackage {
  level: RiskTolerance;
  name: string;
  description: string;
  riskLabel: string;
  cost: number;
}

interface RiskToleranceSelectorProps {
  value: RiskTolerance;
  onChange: (value: RiskTolerance) => void;
  lowCost: number;
  mediumCost: number;
  highCost?: number;
  className?: string;
}

export const RiskToleranceSelector = ({ 
  value, 
  onChange, 
  lowCost, 
  mediumCost, 
  highCost = 0,
  className 
}: RiskToleranceSelectorProps) => {
  const formatCost = (cost: number) => {
    if (cost >= 1000000) {
      return `$${(cost / 1000000).toFixed(1)}M`;
    }
    if (cost >= 1000) {
      return `$${(cost / 1000).toFixed(0)}K`;
    }
    return `$${cost}`;
  };

  const packages: ImplementationPackage[] = [
    {
      level: "high",
      name: "Essential",
      description: "Core Systems Only. Prioritizes the protection of water systems and primary assets through basic process implementation.",
      riskLabel: "High",
      cost: highCost
    },
    {
      level: "medium",
      name: "Enhanced",
      description: "Expanded Scope. Increases protection layers to cover standard construction risks, optimizing the balance between site safety and budget.",
      riskLabel: "Medium",
      cost: mediumCost
    },
    {
      level: "low",
      name: "Fortified",
      description: "Turnkey Protection. Complete coverage of all site systems, assets, and processes. Includes full redundancy and maximum monitoring capabilities.",
      riskLabel: "Low",
      cost: lowCost
    }
  ];

  return (
    <div className={cn("w-full", className)}>
      <div className="border rounded-lg overflow-hidden bg-card">
        {/* Header Row */}
        <div className="grid grid-cols-4 bg-muted/50 border-b">
          <div className="p-4 font-medium text-sm text-muted-foreground">
            Implementation Level
          </div>
          {packages.map((pkg) => (
            <div 
              key={pkg.level}
              className={cn(
                "p-4 font-semibold text-sm cursor-pointer transition-colors border-l",
                value === pkg.level 
                  ? "bg-primary/10 text-primary" 
                  : "hover:bg-muted/80"
              )}
              onClick={() => onChange(pkg.level)}
            >
              <div className="flex items-center gap-2">
                {value === pkg.level && (
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                )}
                {pkg.name}
              </div>
            </div>
          ))}
        </div>

        {/* Description Row */}
        <div className="grid grid-cols-4 border-b">
          <div className="p-4 font-medium text-sm text-muted-foreground">
            Description
          </div>
          {packages.map((pkg) => (
            <div 
              key={pkg.level}
              className={cn(
                "p-4 text-sm border-l cursor-pointer transition-colors",
                value === pkg.level 
                  ? "bg-primary/5" 
                  : "hover:bg-muted/30"
              )}
              onClick={() => onChange(pkg.level)}
            >
              <span className="font-semibold">{pkg.name === "Essential" ? "Core Systems Only." : pkg.name === "Enhanced" ? "Expanded Scope." : "Turnkey Protection."}</span>{" "}
              <span className="text-muted-foreground">
                {pkg.name === "Essential" 
                  ? "Prioritizes the protection of water systems and primary assets through basic process implementation."
                  : pkg.name === "Enhanced"
                    ? "Increases protection layers to cover standard construction risks, optimizing the balance between site safety and budget."
                    : "Complete coverage of all site systems, assets, and processes. Includes full redundancy and maximum monitoring capabilities."
                }
              </span>
            </div>
          ))}
        </div>

        {/* Risk Tolerance Row */}
        <div className="grid grid-cols-4 border-b">
          <div className="p-4 font-medium text-sm text-muted-foreground">
            Risk Tolerance
          </div>
          {packages.map((pkg) => (
            <div 
              key={pkg.level}
              className={cn(
                "p-4 text-sm border-l cursor-pointer transition-colors",
                value === pkg.level 
                  ? "bg-primary/5" 
                  : "hover:bg-muted/30"
              )}
              onClick={() => onChange(pkg.level)}
            >
              <span className={cn(
                "font-medium",
                pkg.riskLabel === "High" && "text-red-600 dark:text-red-400",
                pkg.riskLabel === "Medium" && "text-yellow-600 dark:text-yellow-400",
                pkg.riskLabel === "Low" && "text-green-600 dark:text-green-400"
              )}>
                {pkg.riskLabel}
              </span>
            </div>
          ))}
        </div>

        {/* Cost Estimate Row */}
        <div className="grid grid-cols-4">
          <div className="p-4 font-medium text-sm text-muted-foreground">
            Cost Estimate
          </div>
          {packages.map((pkg) => (
            <div 
              key={pkg.level}
              className={cn(
                "p-4 text-sm border-l cursor-pointer transition-colors",
                value === pkg.level 
                  ? "bg-primary/5" 
                  : "hover:bg-muted/30"
              )}
              onClick={() => onChange(pkg.level)}
            >
              <span className="font-semibold text-foreground">
                {formatCost(pkg.cost)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
