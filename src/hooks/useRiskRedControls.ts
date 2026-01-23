import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface RiskRedControl {
  id: string;
  code: string;
  name: string;
  description: string | null;
  author: string | null;
  responsible: string | null;
  deriskPoints: number | null;
  actions: string | null;
  riskTolerance: number | null;
  oneTimeCost: number | null;
  conceptHours: number | null;
  hourlyRate: number | null;
  monthlyMaintHours: number | null;
  monthlyMaintCost: number | null;
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
        .select("id, code, name, description, author, responsible, derisk_points, actions, risk_tolerance, one_time_cost, concept_hours, hourly_rate, monthly_maint_hours, monthly_maint_cost")
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
        description: item.description,
        author: item.author,
        responsible: item.responsible,
        deriskPoints: item.derisk_points,
        actions: item.actions,
        riskTolerance: item.risk_tolerance,
        oneTimeCost: item.one_time_cost,
        conceptHours: item.concept_hours,
        hourlyRate: item.hourly_rate,
        monthlyMaintHours: item.monthly_maint_hours,
        monthlyMaintCost: item.monthly_maint_cost,
      }));
    },
    staleTime: 1000 * 60 * 30, // Cache for 30 minutes
  });
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
