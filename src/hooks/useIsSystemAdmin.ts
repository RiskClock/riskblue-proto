import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

/**
 * RiskClock staff check.
 *
 * An account is staff when it holds the `system_admin` role or uses an
 * @riskclock.com address (legacy fallback). The email part resolves
 * synchronously so gated UI does not flicker for staff addresses.
 */
export function useIsSystemAdmin(): boolean {
  const { user } = useAuth();
  const byEmail = !!user?.email?.toLowerCase().endsWith("@riskclock.com");

  const { data } = useQuery({
    queryKey: ["is-system-admin", user?.id],
    enabled: !!user?.id && !byEmail,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("is_system_admin", {
        _user_id: user!.id,
      });
      if (error) throw error;
      return data === true;
    },
  });

  return byEmail || data === true;
}

/** Ids of every staff account, used to hide them from company users. */
export function useStaffUserIds(): Set<string> {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ["staff-user-ids"],
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("staff_user_ids");
      if (error) throw error;
      return ((data as any[]) || []).map((r: any) =>
        typeof r === "string" ? r : r.user_id,
      ) as string[];
    },
  });
  return new Set(data ?? []);
}
