import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useMyTenants, useTenant } from "@/contexts/TenantContext";

export function useAccountType() {
  const { user, session } = useAuth() as ReturnType<typeof useAuth> & { session?: { access_token?: string } | null };
  const { tenantId } = useTenant();
  const { data: tenants = [] } = useMyTenants();

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["account-type", user?.id, session?.access_token],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("account_type, company, last_accessed_tenant_id")
        .eq("user_id", user!.id)
        .single();
      if (error) throw error;

      return {
        accountType: (data?.account_type as string | null) || "standard",
        company: (data as any)?.company as string | null,
        lastTenantId: (data as any)?.last_accessed_tenant_id as string | null,
      };
    },
    enabled: !!user,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  // Company (tenant) membership takes precedence over the legacy profile
  // company field, which will be deprecated once everyone is migrated.
  const activeTenant =
    tenants.find((t) => t.id === tenantId) ??
    tenants.find((t) => t.id === data?.lastTenantId) ??
    tenants[0] ??
    null;

  return {
    accountType: data?.accountType,
    isWMSV: data?.accountType === "wmsv",
    company: activeTenant?.name || data?.company || null,
    tenantId: activeTenant?.id ?? null,
    loading: isLoading || isFetching,
  };
}
