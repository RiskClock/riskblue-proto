import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export function useCredits() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["credits-balance", user?.id],
    queryFn: async () => {
      if (!user?.id) return 0;
      const { data, error } = await supabase
        .from("profiles")
        .select("credits_balance")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) throw error;
      return (data?.credits_balance as number | undefined) ?? 0;
    },
    enabled: !!user?.id,
    staleTime: 10_000,
  });

  // Realtime subscription on profile row so balance updates after webhook / consume
  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`credits-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "profiles",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const newBalance = (payload.new as any)?.credits_balance;
          if (typeof newBalance === "number") {
            queryClient.setQueryData(["credits-balance", user.id], newBalance);
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, queryClient]);

  return {
    balance: query.data ?? 0,
    loading: query.isLoading,
    refetch: query.refetch,
  };
}
