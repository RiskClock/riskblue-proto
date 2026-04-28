import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Checks whether a WMSV company has at least one entry in
 * company_control_selections. Returns null until the check completes.
 */
export function useCompanyControlsConfigured(company: string | null | undefined, enabled: boolean = true) {
  const normalized = (company || "").trim().toLowerCase();
  const { data, isLoading } = useQuery({
    queryKey: ["company-controls-configured", normalized],
    queryFn: async () => {
      if (!normalized) return false;
      const { data, error } = await supabase
        .from("company_control_selections")
        .select("id", { head: true, count: "exact" })
        .ilike("company", normalized);
      if (error) throw error;
      // When using head:true with count:exact, count is on the response
      // but supabase-js puts it on the response object.
      const count = (data as any)?.length;
      return Boolean(count && count > 0);
    },
    enabled: enabled && !!normalized,
    staleTime: 1000 * 30,
  });

  return {
    hasControls: data,
    loading: isLoading,
  };
}
