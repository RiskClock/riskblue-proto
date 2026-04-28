import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Checks whether a WMSV company has at least one entry in
 * company_control_selections.
 */
export function useCompanyControlsConfigured(company: string | null | undefined, enabled: boolean = true) {
  const normalized = (company || "").trim().toLowerCase();
  const { data, isLoading } = useQuery({
    queryKey: ["company-controls-configured", normalized],
    queryFn: async () => {
      if (!normalized) return false;
      const { count, error } = await supabase
        .from("company_control_selections")
        .select("id", { head: true, count: "exact" })
        .ilike("company", normalized);
      if (error) throw error;
      return (count ?? 0) > 0;
    },
    enabled: enabled && !!normalized,
    staleTime: 1000 * 30,
  });

  return {
    hasControls: data,
    loading: isLoading,
  };
}
