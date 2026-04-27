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
        .select("account_type, company")
        .eq("user_id", user!.id)
        .single();
      if (error) throw error;

      return {
        accountType: (data?.account_type as string | null) || "standard",
        company: (data as any)?.company as string | null,
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

