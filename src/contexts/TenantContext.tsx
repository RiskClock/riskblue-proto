import { createContext, useContext, useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type TenantRole = "admin" | "member" | "guest";

export type PermissionFlag =
  | "view_projects"
  | "create_project"
  | "edit_project"
  | "delete_project"
  | "export_report"
  | "view_credits"
  | "buy_credits"
  | "manage_members"
  | "manage_tenant_settings";

export interface TenantMembership {
  id: string;
  name: string;
  slug: string | null;
  credits_balance: number | null;
  role: TenantRole;
  permissions: Record<string, boolean>;
  /** True only when the user is an actual member (internal staff see all companies). */
  isMember: boolean;
}

interface TenantContextValue {
  tenants: TenantMembership[];
  loading: boolean;
  tenantId: string | null;
  tenant: TenantMembership | null;
  /** True when the current route is tenant scoped but the user has no access. */
  forbidden: boolean;
  hasPermission: (flag: PermissionFlag) => boolean;
  /** Prefixes a path with the active tenant scope when one exists. */
  tenantPath: (path: string) => string;
  refetch: () => void;
}

const TenantContext = createContext<TenantContextValue | undefined>(undefined);

export const useMyTenants = () => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-tenants", user?.id],
    queryFn: async (): Promise<TenantMembership[]> => {
      const { data, error } = await supabase.rpc("get_my_tenants");
      if (error) throw error;
      return ((data ?? []) as any[]).map((t) => ({
        id: t.id,
        name: t.name,
        slug: t.slug ?? null,
        credits_balance: t.credits_balance ?? null,
        role: t.role as TenantRole,
        permissions: (t.permissions ?? {}) as Record<string, boolean>,
      }));
    },
    enabled: !!user?.id,
    staleTime: 60_000,
  });
};

export const TenantProvider = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuth();
  const params = useParams();
  const queryClient = useQueryClient();
  const routeTenantId = (params as { tenantId?: string }).tenantId ?? null;

  const { data: tenants = [], isLoading, refetch } = useMyTenants();

  const tenant = useMemo(
    () => tenants.find((t) => t.id === routeTenantId) ?? null,
    [tenants, routeTenantId],
  );

  // Remember the last tenant the user visited so login can route back to it.
  useEffect(() => {
    if (!user?.id || !tenant?.id) return;
    void supabase
      .from("profiles")
      .update({ last_accessed_tenant_id: tenant.id })
      .eq("user_id", user.id);
  }, [user?.id, tenant?.id]);

  const value: TenantContextValue = useMemo(
    () => ({
      tenants,
      loading: isLoading,
      tenantId: routeTenantId,
      tenant,
      forbidden: !!routeTenantId && !isLoading && !tenant,
      hasPermission: (flag) => {
        if (!tenant) return false;
        return tenant.permissions?.[flag] === true;
      },
      tenantPath: (path) => {
        const clean = path.startsWith("/") ? path : `/${path}`;
        return routeTenantId ? `/t/${routeTenantId}${clean}` : clean;
      },
      refetch: () => {
        void queryClient.invalidateQueries({ queryKey: ["my-tenants", user?.id] });
        void refetch();
      },
    }),
    [tenants, isLoading, routeTenantId, tenant, queryClient, refetch, user?.id],
  );

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
};

export const useTenant = (): TenantContextValue => {
  const ctx = useContext(TenantContext);
  if (!ctx) {
    // Tenant-less routes render outside the provider.
    return {
      tenants: [],
      loading: false,
      tenantId: null,
      tenant: null,
      forbidden: false,
      hasPermission: () => false,
      tenantPath: (path) => (path.startsWith("/") ? path : `/${path}`),
      refetch: () => {},
    };
  }
  return ctx;
};

/** Convenience hook: permission check that falls back to `true` outside tenant context. */
export const usePermission = (flag: PermissionFlag): boolean => {
  const { tenantId, hasPermission } = useTenant();
  if (!tenantId) return true;
  return hasPermission(flag);
};
