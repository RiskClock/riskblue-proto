import autodeskLogo from "@/assets/autodesk-symbol.png.asset.json";
import procoreLogo from "@/assets/icon_procore.png";
import type { ExternalProvider } from "@/lib/externalAuth";

export const PROVIDER_LOGOS: Record<ExternalProvider, string> = {
  autodesk: autodeskLogo.url,
  procore: procoreLogo,
};
