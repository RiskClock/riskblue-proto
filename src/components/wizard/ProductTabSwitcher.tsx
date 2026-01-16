import { cn } from "@/lib/utils";
import riskBlueLogo from "@/assets/logo-riskblue.png";
import riskRedLogo from "@/assets/logo-riskred.png";

export type ProductType = "riskblue" | "riskred";

interface ProductTabSwitcherProps {
  activeProduct: ProductType;
  onProductChange: (product: ProductType) => void;
  className?: string;
}

export function ProductTabSwitcher({
  activeProduct,
  onProductChange,
  className,
}: ProductTabSwitcherProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <button
        onClick={() => onProductChange("riskblue")}
        className={cn(
          "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all",
          activeProduct === "riskblue"
            ? "bg-primary/10 text-primary border border-primary/30"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
        )}
      >
        <img src={riskBlueLogo} alt="RiskBlue" className="h-5 w-auto" />
        <span>RiskBlue</span>
      </button>
      <button
        onClick={() => onProductChange("riskred")}
        className={cn(
          "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all",
          activeProduct === "riskred"
            ? "bg-destructive/10 text-destructive border border-destructive/30"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
        )}
      >
        <img src={riskRedLogo} alt="RiskRed" className="h-5 w-auto" />
        <span>RiskRed</span>
      </button>
    </div>
  );
}
