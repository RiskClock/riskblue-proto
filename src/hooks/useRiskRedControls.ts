import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface RiskRedControl {
  id: string;
  code: string;
  name: string;
  category: string;
  description: string | null;
}

/**
 * Fetches RiskRed controls from riskred_controls table
 */
export function useRiskRedControls() {
  return useQuery({
    queryKey: ["riskred-controls"],
    queryFn: async (): Promise<RiskRedControl[]> => {
      const { data, error } = await supabase
        .from("riskred_controls")
        .select("id, code, name, category, description")
        .eq("is_active", true)
        .order("display_order");

      if (error) {
        console.error("Error fetching riskred_controls:", error);
        throw error;
      }

      return (data || []).map((item) => ({
        id: item.id,
        code: item.code,
        name: item.name,
        category: item.category,
        description: item.description,
      }));
    },
    staleTime: 1000 * 60 * 30, // Cache for 30 minutes
  });
}

/**
 * Group RiskRed controls by category
 */
export function groupRiskRedControlsByCategory(controls: RiskRedControl[]): Record<string, RiskRedControl[]> {
  return controls.reduce((acc, ctrl) => {
    if (!acc[ctrl.category]) {
      acc[ctrl.category] = [];
    }
    acc[ctrl.category].push(ctrl);
    return acc;
  }, {} as Record<string, RiskRedControl[]>);
}

/**
 * Get control by ID
 */
export function getRiskRedControlById(controls: RiskRedControl[], id: string): RiskRedControl | undefined {
  return controls.find((c) => c.id === id);
}

/**
 * Get control names from IDs
 */
export function getRiskRedControlNamesFromIds(controls: RiskRedControl[], ids: string[]): string[] {
  return ids
    .map((id) => {
      const control = controls.find((c) => c.id === id);
      return control?.name;
    })
    .filter((name): name is string => name !== undefined);
}
