import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export function useAccountType() {
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["account-type", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("account_type")
        .eq("user_id", user!.id)
        .single();
      if (error) throw error;
      return data?.account_type || "standard";
    },
    enabled: !!user,
    staleTime: 1000 * 60 * 30,
  });

  return {
    accountType: data || "standard",
    isWMSV: data === "wmsv",
    loading: isLoading,
  };
}
