import { useQuery } from "@tanstack/react-query";
import { useAccountType } from "@/hooks/useAccountType";
import { fetchCompanyLogoUrl, fallbackBrandLogo } from "@/lib/brandLogo";

/**
 * Logo shown in branded surfaces for the signed-in user.
 * Returns the company logo when one is configured, otherwise the RiskBlue logo.
 */
export function useBrandLogo() {
  const { company } = useAccountType();

  const { data } = useQuery({
    queryKey: ["company-logo", (company || "").toLowerCase()],
    queryFn: () => fetchCompanyLogoUrl(company),
    enabled: !!company,
    staleTime: 60_000,
  });

  return {
    logoUrl: data || fallbackBrandLogo,
    isCompanyLogo: !!data,
    companyName: company,
  };
}
