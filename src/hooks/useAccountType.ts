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
        .select("account_type, company")
        .eq("user_id", user!.id)
        .single();
      if (error) throw error;
      return { accountType: data?.account_type || "standard", company: (data as any)?.company as string | null };
    },
    enabled: !!user,
    staleTime: 1000 * 60 * 30,
  });

  return {
    accountType: data?.accountType || "standard",
    isWMSV: data?.accountType === "wmsv",
    company: data?.company || null,
    loading: isLoading,
  };
}
