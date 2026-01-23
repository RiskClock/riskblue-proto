import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface RiskRedASPOption {
  id: string;
  name: string;
  type: "Asset" | "System" | "Process";
  subcategory: string;
  probability: number;
  impact: number;
  idPrefix: string | null;
  defaultControlIds: string[];
}

/**
 * Fetches RiskRed ASP options from riskred_asp table
 */
export function useRiskRedASPOptions() {
  return useQuery({
    queryKey: ["riskred-asp-options"],
    queryFn: async (): Promise<RiskRedASPOption[]> => {
      const { data, error } = await supabase
        .from("riskred_asp")
        .select("id, name, type, subcategory, probability, impact, id_prefix, default_control_ids")
        .eq("is_active", true)
        .order("display_order");

      if (error) {
        console.error("Error fetching riskred_asp:", error);
        throw error;
      }

      return (data || []).map((item) => ({
        id: item.id,
        name: item.name,
        type: item.type as "Asset" | "System" | "Process",
        subcategory: item.subcategory,
        probability: item.probability,
        impact: item.impact,
        idPrefix: item.id_prefix || null,
        defaultControlIds: (item.default_control_ids as string[]) || [],
      }));
    },
    staleTime: 1000 * 60 * 30, // Cache for 30 minutes
  });
}

/**
 * Group RiskRed ASP options by type
 */
export function groupRiskRedASPByType(options: RiskRedASPOption[]): Record<string, RiskRedASPOption[]> {
  return options.reduce((acc, opt) => {
    if (!acc[opt.type]) {
      acc[opt.type] = [];
    }
    acc[opt.type].push(opt);
    return acc;
  }, {} as Record<string, RiskRedASPOption[]>);
}

/**
 * Group RiskRed ASP options by subcategory within type
 */
export function groupRiskRedASPBySubcategory(options: RiskRedASPOption[]): Record<string, Record<string, RiskRedASPOption[]>> {
  return options.reduce((acc, opt) => {
    if (!acc[opt.type]) {
      acc[opt.type] = {};
    }
    if (!acc[opt.type][opt.subcategory]) {
      acc[opt.type][opt.subcategory] = [];
    }
    acc[opt.type][opt.subcategory].push(opt);
    return acc;
  }, {} as Record<string, Record<string, RiskRedASPOption[]>>);
}

/**
 * Get ASP option by name
 */
export function getRiskRedASPByName(options: RiskRedASPOption[], name: string): RiskRedASPOption | undefined {
  return options.find((o) => o.name === name);
}

/**
 * Get ID prefix for a given ASP name
 */
export function getRiskRedIdPrefixForName(options: RiskRedASPOption[], name: string): string | null {
  const found = options.find((o) => o.name === name);
  return found?.idPrefix || null;
}

/**
 * Get default control IDs for a given ASP name
 */
export function getRiskRedDefaultControlIdsForName(options: RiskRedASPOption[], name: string): string[] {
  const found = options.find((o) => o.name === name);
  return found?.defaultControlIds || [];
}
