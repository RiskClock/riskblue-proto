import { useTenant } from "@/contexts/TenantContext";
import { useSystemAdminStatus } from "@/hooks/useIsSystemAdmin";

/**
 * Beta programs (Product Catalog, Plan Builder) are visible only to companies
 * that opted into the beta. RiskClock staff always see them.
 */
export function useBetaAccess(): { hasBetaAccess: boolean; isLoading: boolean } {
  const { tenant, loading } = useTenant();
  const { isSystemAdmin, isLoading: adminLoading } = useSystemAdminStatus();
  return {
    hasBetaAccess: isSystemAdmin || tenant?.betaEnabled === true,
    isLoading: adminLoading || loading,
  };
}
