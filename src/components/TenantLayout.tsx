import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { TenantProvider, useTenant, useMyTenants } from "@/contexts/TenantContext";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";

const TenantGate = () => {
  const { loading, forbidden, tenant } = useTenant();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="text-lg font-semibold">Company not available</h1>
        <p className="text-sm text-muted-foreground max-w-md">
          You don't have access to this company, or it has been deactivated.
        </p>
        <Button asChild variant="outline">
          <a href="/projects">Go to my projects</a>
        </Button>
      </div>
    );
  }

  if (!tenant) return null;
  return <Outlet />;
};

export const TenantLayout = () => (
  <TenantProvider>
    <TenantGate />
  </TenantProvider>
);

/**
 * Landing redirect: sends the user to their last accessed company, then to
 * their first company, and finally to the personal project list.
 */
export const RootRedirect = ({ fallback }: { fallback?: React.ReactNode } = {}) => {
  const { user } = useAuth();
  const { data: tenants, isLoading } = useMyTenants();
  const [lastTenantId, setLastTenantId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    if (!user?.id) {
      setLastTenantId(null);
      return;
    }
    void (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("last_accessed_tenant_id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!cancelled) setLastTenantId((data as any)?.last_accessed_tenant_id ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  if (isLoading || lastTenantId === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const list = tenants ?? [];
  const target =
    (lastTenantId && list.some((t) => t.id === lastTenantId) && lastTenantId) ||
    list[0]?.id ||
    null;

  if (!target) return <>{fallback ?? <Navigate to="/projects" replace />}</>;
  return <Navigate to={`/t/${target}/projects`} replace />;
};
