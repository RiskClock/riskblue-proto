import { cn } from "@/lib/utils";
import riskBlueLogo from "@/assets/logo-riskblue.png";
import riskRedLogo from "@/assets/logo-riskred.png";

export type ProductType = "riskblue" | "riskred";

interface ProductSectionContainerProps {
  activeProduct: ProductType;
  onProductChange: (product: ProductType) => void;
  children: React.ReactNode;
  className?: string;
}

export function ProductSectionContainer({
  activeProduct,
  onProductChange,
  children,
  className,
}: ProductSectionContainerProps) {
  return (
    <div className={cn("border rounded-lg overflow-hidden", className)}>
      {/* Underlined Product Tabs Header */}
      <div className="flex border-b">
        <button
          onClick={() => onProductChange("riskblue")}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 py-3 px-4 text-sm font-medium transition-all relative",
            activeProduct === "riskblue"
              ? "text-primary"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
          )}
        >
          <img src={riskBlueLogo} alt="RiskBlue" className="h-5 w-auto" />
          <span>RiskBlue</span>
          {activeProduct === "riskblue" && (
            <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-primary" />
          )}
        </button>
        <button
          onClick={() => onProductChange("riskred")}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 py-3 px-4 text-sm font-medium transition-all relative",
            activeProduct === "riskred"
              ? "text-destructive"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
          )}
        >
          <img src={riskRedLogo} alt="RiskRed" className="h-5 w-auto" />
          <span>RiskRed</span>
          {activeProduct === "riskred" && (
            <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-destructive" />
          )}
        </button>
      </div>

      {/* Content */}
      <div className="px-6 py-4">
        {children}
      </div>
    </div>
  );
}
