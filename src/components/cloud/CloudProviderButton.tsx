import { forwardRef } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import autodeskLogo from "@/assets/autodesk-symbol.png.asset.json";
import procoreLogo from "@/assets/icon_procore.png";
import { CLOUD_PROVIDER_LABEL, type CloudProvider } from "@/lib/cloudImport";

export const CLOUD_PROVIDER_LOGO: Record<CloudProvider, string> = {
  forma: autodeskLogo.url,
  procore: procoreLogo,
};

export function CloudProviderLogo({ provider, className = "h-4 w-4" }: { provider: CloudProvider; className?: string }) {
  return <img src={CLOUD_PROVIDER_LOGO[provider]} alt="" aria-hidden="true" className={`${className} shrink-0 object-contain`} />;
}

/** Consistent "{logo} {title}" button for cloud drawing sources. */
export const CloudProviderButton = forwardRef<HTMLButtonElement, ButtonProps & { provider: CloudProvider; label?: string }>(
  ({ provider, label, className, children, ...props }, ref) => (
    <Button ref={ref} type="button" variant="outline" className={`gap-2 ${className ?? ""}`} {...props}>
      <CloudProviderLogo provider={provider} />
      <span>{label ?? CLOUD_PROVIDER_LABEL[provider]}</span>
      {children}
    </Button>
  ),
);
CloudProviderButton.displayName = "CloudProviderButton";
