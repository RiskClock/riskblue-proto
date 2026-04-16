import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export function useAccountType() {
  const { user, session } = useAuth() as ReturnType<typeof useAuth> & { session?: { access_token?: string } | null };

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["account-type", user?.id, session?.access_token],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("account_type")
        .eq("user_id", user!.id)
        .single();
      if (error) throw error;

      const { data: raw } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", user!.id)
        .single();

      return {
        accountType: data?.account_type || "standard",
        company: (raw as any)?.company as string | null,
      };
    },
    enabled: !!user,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  return {
    accountType: data?.accountType,
    isWMSV: data?.accountType === "wmsv",
    company: data?.company || null,
    loading: isLoading || isFetching,
  };
}

